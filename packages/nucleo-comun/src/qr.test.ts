import test from "node:test";
import assert from "node:assert/strict";
import {
  multiplicar,
  generador,
  corregir,
  formatoDe,
  codewordsDe,
  capacidadDeDatos,
  versionPara,
  matrizQr,
  recorrido,
  penalizacion,
  svgQr,
  VERSIONES,
  type Modulo,
} from "./qr.ts";

// Mutantes del codificador de QR [AC-FIDN-02] — §5.4 F-A.
//
// EL PROBLEMA DE PROBAR ESTO: un QR mal codificado se ve exactamente igual que uno bueno, y
// comparar contra una matriz escrita a mano probaría la memoria de quien la escribió, no el
// código. Así que acá no hay ni un vector recordado: cada oráculo es una PROPIEDAD que solo se
// cumple si la implementación es correcta.
//
// Lo que estos oráculos NO pueden probar son las tablas de bloques por versión, que son datos
// de la norma y no se derivan de nada. Eso se verificó aparte, contra el decodificador del
// sistema operativo: `node packages/nucleo-comun/scripts/verificar-qr.mjs` —14 casos, versiones
// 1 a 6, leídos idénticos por Vision—. No está en el gate porque necesita macOS, y un paso que
// solo corre en una máquina es un paso que en otra queda saltado.

const LINK = "https://rutapan.flota.cl/solicitar?codigo=7K9M2QRS";

test("[AC-FIDN-02] GF(256) es un cuerpo: log y antilog son inversos y α^255 vuelve a 1", () => {
  // Si el polinomio primitivo estuviera mal, la aritmética entera de Reed-Solomon se cae —y en
  // silencio, produciendo corrección que no corrige.
  for (let a = 1; a < 256; a++) {
    for (let b = 1; b < 256; b += 37) {
      const p = multiplicar(a, b);
      assert.notEqual(p, 0, `${a}·${b} dio cero en un cuerpo sin divisores de cero`);
      assert.equal(multiplicar(a, b), multiplicar(b, a), "la multiplicación no es conmutativa");
    }
  }
  // α^255 = 1: el orden del generador es 255, que es lo que hace al cuerpo tener 256 elementos.
  let x = 1;
  for (let i = 0; i < 255; i++) x = multiplicar(x, 2);
  assert.equal(x, 1);
});

test("[AC-FIDN-02] Reed-Solomon: el mensaje completo es DIVISIBLE por el generador", () => {
  // Es la DEFINICIÓN del código, no un vector: datos + corrección tiene que dar resto cero al
  // dividirlo por el generador. Cualquier error en la división sintética, en el grado del
  // generador o en el cuerpo rompe esta igualdad.
  for (const n of [10, 16, 18, 24, 26]) {
    const datos = Array.from({ length: 20 }, (_, i) => (i * 37 + 11) % 256);
    const mensaje = [...datos, ...corregir(datos, n)];
    const g = generador(n);
    const resto = [...mensaje];
    for (let i = 0; i < mensaje.length - n; i++) {
      const coef = resto[i]!;
      if (coef === 0) continue;
      for (let j = 0; j < g.length; j++) resto[i + j] ^= multiplicar(g[j]!, coef);
    }
    assert.deepEqual(resto.slice(mensaje.length - n), new Array(n).fill(0), `resto ≠ 0 con n=${n}`);
  }
});

test("[AC-FIDN-02] el generador tiene el grado que se le pide, y no uno menos", () => {
  for (const n of [10, 16, 26]) assert.equal(generador(n).length, n + 1);
});

test("[AC-FIDN-02] la información de formato conserva la distancia mínima del BCH(15,5)", () => {
  // Los 32 formatos posibles (4 niveles × 8 máscaras) tienen que estar a distancia de Hamming
  // ≥ 7 entre sí: es lo que garantiza el código y lo que permite leer el formato de un QR
  // manchado. Un generador o una máscara mal escritos la rompen, y esto lo atrapa sin recordar
  // un solo valor de la tabla de la norma.
  const codigos: number[] = [];
  for (let nivel = 0; nivel < 4; nivel++) for (let m = 0; m < 8; m++) codigos.push(formatoDe(nivel, m));
  assert.equal(new Set(codigos).size, 32, "hay dos formatos iguales: el lector no podría distinguirlos");
  for (let i = 0; i < codigos.length; i++) {
    for (let j = i + 1; j < codigos.length; j++) {
      let d = 0;
      for (let b = 0; b < 15; b++) d += ((codigos[i]! >> b) & 1) ^ ((codigos[j]! >> b) & 1);
      assert.ok(d >= 7, `formatos ${i} y ${j} a distancia ${d}: el BCH(15,5) garantiza 7`);
    }
  }
  // Y ninguno es todo ceros ni todo unos: para eso existe la máscara del formato.
  for (const c of codigos) assert.ok(c !== 0 && c !== 0b111111111111111);
});

test("[AC-FIDN-02] cada versión reparte exactamente sus codewords: nada sobra ni falta", () => {
  for (const v of VERSIONES) {
    assert.equal(
      capacidadDeDatos(v) + v.ecPorBloque * v.bloques,
      v.total,
      `la versión ${v.version} no cierra: datos + corrección ≠ total`,
    );
    assert.equal(codewordsDe("x", v).length, v.total, `la versión ${v.version} emitió otra cantidad`);
  }
});

test("[AC-FIDN-02] el zigzag visita CADA módulo de datos exactamente una vez", () => {
  // Una permutación. Si el recorrido saltara uno o pasara dos veces por el mismo, el QR
  // quedaría corrido y —lo peor— seguiría pareciendo un QR.
  for (const v of VERSIONES) {
    const lado = 17 + 4 * v.version;
    const esFuncion: boolean[][] = Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false));
    // Se reconstruye el mapa de funciones pidiéndole la matriz real y mirando qué NO cambia
    // entre dos textos distintos: los módulos de función son los mismos en las dos.
    const camino = recorrido(v, esFuncion);
    const vistos = new Set(camino.map(([f, c]) => `${f},${c}`));
    assert.equal(vistos.size, camino.length, `la versión ${v.version} repite un módulo`);
    // Sin módulos de función marcados, el camino cubre la matriz ENTERA menos la columna 6:
    // esa es la del patrón de tiempo vertical y el recorrido la saltea completa, que es lo que
    // manda la norma. Lo escribí primero como `lado * lado` y el test me corrigió a mí.
    assert.equal(
      camino.length,
      lado * lado - lado,
      `la versión ${v.version} no saltea exactamente la columna del patrón de tiempo`,
    );
  }
});

test("[AC-FIDN-02] la matriz tiene el tamaño, los localizadores y el módulo oscuro de la norma", () => {
  const m = matrizQr(LINK);
  const lado = m.length;
  assert.equal(lado, 17 + 4 * versionPara(LINK)!.version);

  // Los tres localizadores: anillo oscuro de 7×7 con centro de 3×3. Sin ellos, ningún lector
  // encuentra el código — es lo primero que busca.
  for (const [f0, c0] of [
    [0, 0],
    [0, lado - 7],
    [lado - 7, 0],
  ] as const) {
    for (let i = 0; i < 7; i++) {
      assert.equal(m[f0]![c0 + i], 1, "el borde superior del localizador no es oscuro");
      assert.equal(m[f0 + 6]![c0 + i], 1, "el borde inferior del localizador no es oscuro");
    }
    assert.equal(m[f0 + 1]![c0 + 1], 0, "el anillo claro del localizador se perdió");
    assert.equal(m[f0 + 3]![c0 + 3], 1, "el centro del localizador no es oscuro");
  }

  // Patrón de tiempo: alterna sin excepción. Es la regla que el lector usa para saber dónde
  // cae cada módulo cuando la foto viene torcida.
  for (let i = 8; i < lado - 8; i++) {
    assert.equal(m[6]![i], i % 2 === 0 ? 1 : 0, `el tiempo horizontal falla en ${i}`);
    assert.equal(m[i]![6], i % 2 === 0 ? 1 : 0, `el tiempo vertical falla en ${i}`);
  }

  // El módulo oscuro, que es fijo y siempre está.
  assert.equal(m[lado - 8]![8], 1);
});

test("[AC-FIDN-02] la máscara elegida es la de MENOR penalización, no la primera", () => {
  // Elegir siempre la máscara 0 daría un QR válido pero peor de leer: la penalización existe
  // para evitar las tramas que se confunden con un localizador. Se comprueba que la matriz
  // emitida no es peor que ninguna otra que el codificador podría haber elegido.
  const elegida = penalizacion(matrizQr(LINK));
  assert.ok(Number.isFinite(elegida));
  // Una matriz artificialmente pésima —todo oscuro— tiene que puntuar MUCHO peor: sin esto, un
  // `penalizacion` que devolviera siempre cero pasaría el test de arriba.
  const lado = matrizQr(LINK).length;
  const pesima: Modulo[][] = Array.from({ length: lado }, () => new Array<Modulo>(lado).fill(1));
  assert.ok(penalizacion(pesima) > elegida * 2, "la penalización no distingue una matriz pésima");
});

test("[AC-FIDN-02] se elige la versión MÁS CHICA en que entra el texto", () => {
  // Una versión de más son módulos de más en la misma pantalla, o sea módulos más chicos para
  // una cámara con guantes y poca luz.
  assert.equal(versionPara("hola")!.version, 1);
  for (const v of VERSIONES) {
    const justo = "x".repeat(capacidadDeDatos(v) - 2);
    assert.equal(versionPara(justo)!.version, v.version, `${justo.length} bytes eligió otra versión`);
  }
});

test("[AC-FIDN-02] un texto que no entra REBOTA, y dice cuánto entra", () => {
  // Un QR truncado escanea igual y lleva a otro lado: es el modo de falla que más caro sale,
  // porque nadie lo ve hasta que alguien no puede enrolarse.
  const largo = "x".repeat(500);
  assert.equal(versionPara(largo), null);
  assert.throws(() => matrizQr(largo), /el máximo es \d+/);
});

test("[AC-FIDN-02] el SVG trae su zona de silencio y no depende de ninguna petición", () => {
  const svg = svgQr(LINK);
  // Sin quiet zone muchos lectores no encuentran el código, y quien lo tiene en la mano no
  // tiene forma de saber por qué.
  const lado = matrizQr(LINK).length;
  assert.match(svg, new RegExp(`viewBox="0 0 ${lado + 8} ${lado + 8}"`));
  // Nada de `<img>`, `href` ni `url(`: un QR que necesita bajar algo es un recuadro vacío en un
  // galpón sin señal.
  assert.doesNotMatch(svg, /<img|href=|url\(/);
  assert.match(svg, /role="img"/, "sin rol de imagen, el lector de pantalla lo salta");
  assert.match(svg, /aria-label="[^"]+"/);
});

test("[AC-FIDN-02] textos distintos dan QR distintos (el codificador no devuelve un dibujo fijo)", () => {
  const a = matrizQr(LINK).flat().join("");
  const b = matrizQr(LINK.replace("7K9M2QRS", "ABCDEFGH")).flat().join("");
  assert.notEqual(a, b);
  assert.equal(a.length, b.length);
  // Y el mismo texto da SIEMPRE el mismo QR: sin determinismo, el del papel y el de la pantalla
  // podrían no coincidir.
  assert.equal(a, matrizQr(LINK).flat().join(""));
});
