// Codificador de QR, propio y sin dependencias [AC-FIDN-02] — §5.4 F-A.
//
// POR QUÉ NO UNA LIBRERÍA. Decisión de Alexis (09-ago-2026). El QR vive en la pantalla que
// emite la invitación de enrolamiento: el módulo que guarda RUTs y PINs. Una dependencia de
// terceros ahí es superficie de cadena de suministro y peso en el bundle que un teléfono baja
// con la señal de un galpón, a cambio de un algoritmo cerrado y estable desde 2006. Se escribe
// una vez y no vuelve a cambiar.
//
// ALCANCE DECLARADO, no supuesto: modo BYTE, nivel de corrección M, versiones 1 a 6. Alcanza
// para el link de invitación (`https://<slug>.<dominio>/solicitar?codigo=XXXXXXXX`, ~50 bytes)
// con margen. Un texto que no entre REBOTA con el largo máximo en el mensaje — jamás genera un
// QR truncado, que es un QR que escanea y lleva a otro lado.
//
// ─── CÓMO SE VERIFICA ALGO QUE NO SE PUEDE LEER A OJO ─────────────────────────────────
//
// Un QR mal codificado se ve exactamente igual que uno bueno. Por eso los oráculos de
// `qr.test.ts` no comparan contra una matriz escrita de memoria —eso probaría la memoria de
// quien la escribió— sino contra PROPIEDADES que solo se cumplen si la implementación es
// correcta:
//
//   · Reed-Solomon: el polinomio del mensaje (datos + corrección) tiene que ser DIVISIBLE por
//     el generador. Se verifica dividiendo: resto cero. Es la definición del código, no un
//     vector recordado.
//   · GF(256): α^255 = 1, log y antilog inversos, y la multiplicación consistente con los
//     logaritmos. El cuerpo se prueba solo.
//   · Información de formato: los 32 códigos posibles tienen distancia de Hamming ≥ 7 entre
//     sí, que es la distancia mínima garantizada del BCH(15,5). Un generador mal escrito la
//     rompe, y esto lo atrapa sin recordar un solo valor de la tabla.
//   · Colocación: el recorrido en zigzag visita CADA módulo de datos exactamente una vez —una
//     permutación—, y leer de vuelta lo colocado devuelve el flujo original.
//
// Y la validación que ninguna de esas da: las tablas de bloques por versión son datos de la
// norma que no se derivan. Se comprobaron contra un decodificador INDEPENDIENTE —el del
// sistema operativo, vía `packages/nucleo-comun/scripts/verificar-qr.swift`— codificando y
// volviendo a leer. Ese script NO está en el gate: necesita macOS, y un paso que solo corre en
// una máquina es un paso que en otra queda saltado. Está en el repo para volver a correrlo el
// día que se toque una tabla.

/** Niveles de corrección del §0 de la norma. Acá se usa M, que es el equilibrio habitual. */
const NIVEL_M_BITS = 0b00;

/**
 * Por versión (1..6), en nivel M: codewords totales, codewords de corrección POR BLOQUE, y
 * cuántos bloques. Son datos de la norma —no se derivan— y por eso el total se verifica: la
 * suma de datos y corrección de todos los bloques tiene que dar exactamente `total`.
 */
const VERSIONES = [
  { version: 1, total: 26, ecPorBloque: 10, bloques: 1 },
  { version: 2, total: 44, ecPorBloque: 16, bloques: 1 },
  { version: 3, total: 70, ecPorBloque: 26, bloques: 1 },
  { version: 4, total: 100, ecPorBloque: 18, bloques: 2 },
  { version: 5, total: 134, ecPorBloque: 24, bloques: 2 },
  { version: 6, total: 172, ecPorBloque: 16, bloques: 4 },
] as const;

/** Centros de los patrones de alineación por versión. Vacío en la 1: no los lleva. */
const ALINEACION: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

export type Version = (typeof VERSIONES)[number];

/** Datos útiles (en codewords) que entran en una versión: total menos toda la corrección. */
export function capacidadDeDatos(v: Version): number {
  return v.total - v.ecPorBloque * v.bloques;
}

// ─── GF(256), el cuerpo sobre el que vive Reed-Solomon ────────────────────────────────
//
// Polinomio primitivo 0x11D, el de la norma. Las tablas de log y antilog se construyen una vez
// y hacen que multiplicar sea sumar logaritmos, que es lo que vuelve barato al algoritmo.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function multiplicar(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** El generador de grado `n`: (x - α^0)(x - α^1)…(x - α^(n-1)), en coeficientes descendentes. */
export function generador(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const siguiente = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      siguiente[j]! ^= multiplicar(g[j]!, 1);
      siguiente[j + 1]! ^= multiplicar(g[j]!, EXP[i]!);
    }
    g = siguiente;
  }
  return g;
}

/** Los `n` codewords de corrección de un bloque: el RESTO de dividir por el generador. */
export function corregir(datos: number[], n: number): number[] {
  const g = generador(n);
  const resto = [...datos, ...new Array<number>(n).fill(0)];
  for (let i = 0; i < datos.length; i++) {
    const coef = resto[i]!;
    if (coef === 0) continue;
    for (let j = 0; j < g.length; j++) resto[i + j] = resto[i + j]! ^ multiplicar(g[j]!, coef);
  }
  return resto.slice(datos.length);
}

// ─── Información de formato: BCH(15,5) ────────────────────────────────────────────────

const BCH_GENERADOR = 0b10100110111;
/** Máscara de la norma. Existe para que el formato con todos los bits en cero no pueda
 *  aparecer nunca: un QR sin marcas se leería como uno con formato válido. */
const BCH_MASCARA = 0b101010000010010;

export function formatoDe(nivelBits: number, mascara: number): number {
  const datos = (nivelBits << 3) | mascara;
  let resto = datos << 10;
  for (let i = 14; i >= 10; i--) {
    if ((resto >> i) & 1) resto ^= BCH_GENERADOR << (i - 10);
  }
  return ((datos << 10) | resto) ^ BCH_MASCARA;
}

// ─── El flujo de bits ─────────────────────────────────────────────────────────────────

class Bits {
  private bits: number[] = [];
  agregar(valor: number, largo: number) {
    for (let i = largo - 1; i >= 0; i--) this.bits.push((valor >> i) & 1);
  }
  get largo() {
    return this.bits.length;
  }
  /** A codewords de 8 bits, rellenando el último con ceros. */
  aCodewords(): number[] {
    const salida: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      salida.push(byte);
    }
    return salida;
  }
}

/** Los dos bytes de relleno que alterna la norma cuando sobra espacio. */
const RELLENO = [0xec, 0x11];

/**
 * El flujo completo de codewords de un texto: cabecera de modo byte, largo, datos, terminador,
 * relleno, y los bloques de corrección INTERCALADOS como pide la norma.
 */
export function codewordsDe(texto: string, v: Version): number[] {
  const datos = new TextEncoder().encode(texto);
  const capacidad = capacidadDeDatos(v);

  const bits = new Bits();
  bits.agregar(0b0100, 4); // modo byte
  bits.agregar(datos.length, 8); // versiones 1..9: el largo va en 8 bits
  for (const b of datos) bits.agregar(b, 8);
  // Terminador: hasta 4 ceros, y solo los que quepan.
  bits.agregar(0, Math.min(4, capacidad * 8 - bits.largo));

  const codewords = bits.aCodewords();
  for (let i = 0; codewords.length < capacidad; i++) codewords.push(RELLENO[i % 2]!);

  // Bloques: los primeros llevan un codeword menos cuando la división no es exacta. En las
  // versiones 1..6 de nivel M la división SÍ es exacta, y se verifica en vez de suponerse.
  const porBloque = capacidad / v.bloques;
  if (!Number.isInteger(porBloque)) {
    throw new Error(`la versión ${v.version} no reparte ${capacidad} codewords en ${v.bloques} bloques`);
  }

  const bloquesDatos: number[][] = [];
  const bloquesEc: number[][] = [];
  for (let b = 0; b < v.bloques; b++) {
    const bloque = codewords.slice(b * porBloque, (b + 1) * porBloque);
    bloquesDatos.push(bloque);
    bloquesEc.push(corregir(bloque, v.ecPorBloque));
  }

  // INTERCALADO: primero el codeword 0 de cada bloque, después el 1 de cada uno… Es lo que
  // hace que una mancha de tinta se reparta entre bloques en vez de arruinar uno solo.
  const salida: number[] = [];
  for (let i = 0; i < porBloque; i++) for (const b of bloquesDatos) salida.push(b[i]!);
  for (let i = 0; i < v.ecPorBloque; i++) for (const b of bloquesEc) salida.push(b[i]!);
  return salida;
}

// ─── La matriz ────────────────────────────────────────────────────────────────────────

export type Modulo = 0 | 1;
type Celda = Modulo | null;

const ladoDe = (version: number) => 17 + 4 * version;

/** Marca los patrones fijos y devuelve, aparte, qué posiciones son de función (no de datos). */
function conFunciones(v: Version): { celdas: Celda[][]; esFuncion: boolean[][] } {
  const lado = ladoDe(v.version);
  const celdas: Celda[][] = Array.from({ length: lado }, () => new Array<Celda>(lado).fill(null));
  const esFuncion: boolean[][] = Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false));

  const poner = (f: number, c: number, valor: Modulo) => {
    if (f < 0 || c < 0 || f >= lado || c >= lado) return;
    celdas[f]![c] = valor;
    esFuncion[f]![c] = true;
  };

  // Los tres localizadores, con su separador de un módulo claro.
  for (const [f0, c0] of [
    [0, 0],
    [0, lado - 7],
    [lado - 7, 0],
  ] as const) {
    for (let f = -1; f <= 7; f++) {
      for (let c = -1; c <= 7; c++) {
        const borde = f === -1 || f === 7 || c === -1 || c === 7;
        const anillo = f === 0 || f === 6 || c === 0 || c === 6;
        const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
        poner(f0 + f, c0 + c, borde ? 0 : anillo || centro ? 1 : 0);
      }
    }
  }

  // Patrones de tiempo: la referencia de la grilla para el lector.
  for (let i = 8; i < lado - 8; i++) {
    const valor: Modulo = i % 2 === 0 ? 1 : 0;
    poner(6, i, valor);
    poner(i, 6, valor);
  }

  // Alineación, salteando los que caerían encima de un localizador.
  const centros = ALINEACION[v.version] ?? [];
  for (const f0 of centros) {
    for (const c0 of centros) {
      const enLocalizador =
        (f0 <= 8 && c0 <= 8) || (f0 <= 8 && c0 >= lado - 9) || (f0 >= lado - 9 && c0 <= 8);
      if (enLocalizador) continue;
      for (let f = -2; f <= 2; f++) {
        for (let c = -2; c <= 2; c++) {
          const anillo = Math.abs(f) === 2 || Math.abs(c) === 2;
          poner(f0 + f, c0 + c, anillo || (f === 0 && c === 0) ? 1 : 0);
        }
      }
    }
  }

  // El módulo oscuro, que es fijo y siempre está.
  poner(lado - 8, 8, 1);
  // Reserva del formato: se rellena después, pero no puede recibir datos.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      esFuncion[8]![i] = true;
      esFuncion[i]![8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    esFuncion[8]![lado - 1 - i] = true;
    esFuncion[lado - 1 - i]![8] = true;
  }

  return { celdas, esFuncion };
}

/** El recorrido en zigzag de la norma: columnas de a dos, de derecha a izquierda, alternando. */
export function recorrido(v: Version, esFuncion: boolean[][]): [number, number][] {
  const lado = ladoDe(v.version);
  const camino: [number, number][] = [];
  let arriba = true;
  for (let c = lado - 1; c >= 0; c -= 2) {
    const col = c === 6 ? c - 1 : c; // la columna 6 es de tiempo: se saltea entera
    for (let i = 0; i < lado; i++) {
      const f = arriba ? lado - 1 - i : i;
      for (const cc of [col, col - 1]) {
        if (cc < 0) continue;
        if (!esFuncion[f]![cc]) camino.push([f, cc]);
      }
    }
    arriba = !arriba;
    if (col !== c) c--;
  }
  return camino;
}

const MASCARAS: ((f: number, c: number) => boolean)[] = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (_f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
];

/** Las cuatro penalizaciones de la norma. Menor puntaje = máscara elegida. */
export function penalizacion(m: Modulo[][]): number {
  const lado = m.length;
  let total = 0;

  // 1. Corridas de 5 o más del mismo color, en filas y en columnas.
  for (const porFila of [true, false]) {
    for (let a = 0; a < lado; a++) {
      let corrida = 1;
      for (let b = 1; b < lado; b++) {
        const actual = porFila ? m[a]![b]! : m[b]![a]!;
        const previo = porFila ? m[a]![b - 1]! : m[b - 1]![a]!;
        if (actual === previo) {
          corrida++;
          if (corrida === 5) total += 3;
          else if (corrida > 5) total += 1;
        } else corrida = 1;
      }
    }
  }

  // 2. Bloques de 2×2 del mismo color.
  for (let f = 0; f < lado - 1; f++) {
    for (let c = 0; c < lado - 1; c++) {
      const v = m[f]![c]!;
      if (v === m[f]![c + 1] && v === m[f + 1]![c] && v === m[f + 1]![c + 1]) total += 3;
    }
  }

  // 3. El patrón que se confunde con un localizador, en los dos sentidos y en las dos
  //    orientaciones. Es la penalización que de verdad decide entre máscaras parecidas.
  const PATRON = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const invertido = [...PATRON].reverse();
  for (const porFila of [true, false]) {
    for (let a = 0; a < lado; a++) {
      for (let b = 0; b + 11 <= lado; b++) {
        const trozo = Array.from({ length: 11 }, (_, i) => (porFila ? m[a]![b + i]! : m[b + i]![a]!));
        if (trozo.every((x, i) => x === PATRON[i]) || trozo.every((x, i) => x === invertido[i])) {
          total += 40;
        }
      }
    }
  }

  // 4. Desbalance entre oscuros y claros.
  const oscuros = m.flat().filter((x) => x === 1).length;
  const porcentaje = (oscuros * 100) / (lado * lado);
  total += Math.floor(Math.abs(porcentaje - 50) / 5) * 10;
  return total;
}

/** La versión más chica en que entra el texto, o null si no entra en ninguna. */
export function versionPara(texto: string): Version | null {
  const bytes = new TextEncoder().encode(texto).length;
  // 2 codewords de cabecera: 4 bits de modo + 8 de largo, más el terminador.
  return VERSIONES.find((v) => bytes + 2 <= capacidadDeDatos(v)) ?? null;
}

/** La matriz de módulos, ya enmascarada y con su información de formato. */
export function matrizQr(texto: string): Modulo[][] {
  const v = versionPara(texto);
  if (!v) {
    const tope = capacidadDeDatos(VERSIONES[VERSIONES.length - 1]!) - 2;
    throw new Error(
      `el texto no entra en un QR de hasta la versión ${VERSIONES[VERSIONES.length - 1]!.version} ` +
        `(${new TextEncoder().encode(texto).length} bytes; el máximo es ${tope}). Un QR truncado ` +
        "escanea igual y lleva a otro lado, así que esto rebota en vez de recortar.",
    );
  }

  const flujo = codewordsDe(texto, v);
  const { celdas, esFuncion } = conFunciones(v);
  const camino = recorrido(v, esFuncion);

  const bits: Modulo[] = [];
  for (const cw of flujo) for (let i = 7; i >= 0; i--) bits.push(((cw >> i) & 1) as Modulo);
  // Los módulos que sobran quedan en claro, como manda la norma.
  camino.forEach(([f, c], i) => {
    celdas[f]![c] = bits[i] ?? 0;
  });

  const lado = ladoDe(v.version);
  let mejor: { matriz: Modulo[][]; mascara: number; puntaje: number } | null = null;
  for (let mascara = 0; mascara < MASCARAS.length; mascara++) {
    const matriz: Modulo[][] = celdas.map((fila, f) =>
      fila.map((valor, c) =>
        esFuncion[f]![c] ? ((valor ?? 0) as Modulo) : (((valor ?? 0) ^ (MASCARAS[mascara]!(f, c) ? 1 : 0)) as Modulo),
      ),
    );
    ponerFormato(matriz, mascara, lado);
    const puntaje = penalizacion(matriz);
    if (!mejor || puntaje < mejor.puntaje) mejor = { matriz, mascara, puntaje };
  }
  return mejor!.matriz;
}

/** El formato va DOS veces, en las dos esquinas: si una se mancha, el lector usa la otra. */
function ponerFormato(m: Modulo[][], mascara: number, lado: number) {
  const formato = formatoDe(NIVEL_M_BITS, mascara);
  const bit = (i: number): Modulo => ((formato >> i) & 1) as Modulo;
  for (let i = 0; i <= 5; i++) m[8]![i] = bit(14 - i);
  m[8]![7] = bit(8);
  m[8]![8] = bit(7);
  m[7]![8] = bit(6);
  for (let i = 9; i <= 14; i++) m[14 - i]![8] = bit(14 - i);
  for (let i = 0; i <= 7; i++) m[lado - 1 - i]![8] = bit(i);
  for (let i = 8; i <= 14; i++) m[8]![lado - 15 + i] = bit(i);
}

/**
 * El QR como SVG, listo para meter en la pantalla. Sin `<img>` ni canvas: un SVG en el DOM se
 * imprime nítido a cualquier tamaño y no necesita una petición más — que en un galpón sin señal
 * es la diferencia entre un QR y un recuadro vacío.
 *
 * El QUIET ZONE de 4 módulos no es margen decorativo: sin él muchos lectores no encuentran el
 * código, y el que lo tiene en la mano no tiene forma de saber por qué.
 */
export function svgQr(texto: string, { escala = 4, quiet = 4 } = {}): string {
  const m = matrizQr(texto);
  const lado = m.length + quiet * 2;
  const partes: string[] = [];
  for (let f = 0; f < m.length; f++) {
    for (let c = 0; c < m.length; c++) {
      if (m[f]![c] === 1) partes.push(`M${c + quiet} ${f + quiet}h1v1h-1z`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" ` +
    `width="${lado * escala}" height="${lado * escala}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="Código QR de la invitación">` +
    `<rect width="${lado}" height="${lado}" fill="#FFFFFF"/>` +
    `<path fill="#000000" d="${partes.join("")}"/></svg>`
  );
}

export { VERSIONES };
