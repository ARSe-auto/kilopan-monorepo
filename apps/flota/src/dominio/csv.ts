// Un lector de CSV propio, con sus mutantes [AC-FRUT-02] — §5.2-F1, §7.1.
//
// ─── POR QUÉ PROPIO ─────────────────────────────────────────────────────────────────
//
// Mismo criterio que el codificador de QR (AC-FIDN-02, decisión de Alexis): el archivo que el
// operador sube trae los encargos del día de sus clientes, y una dependencia de terceros acá es
// superficie de cadena de suministro sobre el camino por el que entran datos de negocio. El
// formato que hace falta cabe en cincuenta líneas.
//
// ─── QUÉ SOPORTA, Y POR QUÉ ESO Y NO MÁS ────────────────────────────────────────────
//
// Lo que produce Excel en Chile y lo que produce un ERP: comas o punto y coma como separador
// —Excel en configuración regional es-CL exporta con punto y coma—, comillas dobles para
// encerrar campos con separadores adentro, comillas duplicadas para escapar una comilla, y
// finales de línea CRLF o LF. Nada de `\` como escape: no está en el RFC 4180 y su presencia
// silenciosa haría que una dirección con una barra se leyera partida.
//
// LO QUE NO HACE: adivinar. Si el archivo no tiene encabezado o le falta una columna, se dice
// —con el nombre de la que falta— en vez de asumir un orden. Un CSV mal mapeado no falla: entra
// todo cambiado de lugar, y eso se descubre con el camión cargado.

export type FilaDeCsv = Record<string, string>;

export type LecturaDeCsv =
  | { tipo: "ok"; filas: FilaDeCsv[]; columnas: string[] }
  | { tipo: "vacio" }
  | { tipo: "faltan_columnas"; columnas: string[] };

/** Los dos separadores que se ven en Chile: la coma del estándar y el punto y coma de Excel. */
function separadorDe(linea: string): string {
  const comas = (linea.match(/,/g) ?? []).length;
  const puntoYComa = (linea.match(/;/g) ?? []).length;
  return puntoYComa > comas ? ";" : ",";
}

/** Parte UNA línea respetando comillas. Escrito a mano porque un `split` parte las direcciones
 *  que llevan coma adentro — y una dirección partida manda un camión a otra parte. */
export function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Dos comillas seguidas DENTRO de un campo entrecomillado son una comilla literal
      // (RFC 4180). Sin esto, un nombre como «Panadería "La Espiga"» corta el campo al medio.
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
      continue;
    }
    if (c === separador && !entreComillas) {
      campos.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

/**
 * Lee el CSV entero con su encabezado. Las columnas se normalizan a minúsculas sin acentos
 * para que «Bultos», «bultos» y «BULTOS» sean la misma: quien exporta desde Excel no controla
 * cómo quedó escrito el encabezado, y rechazarle el archivo por una mayúscula es hacerle
 * perder el tiempo por algo que no es su problema.
 */
export function leerCsv(texto: string, requeridas: string[]): LecturaDeCsv {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lineas.length < 2) return { tipo: "vacio" };

  const separador = separadorDe(lineas[0]!);
  const columnas = partirLinea(lineas[0]!, separador).map(normalizarColumna);
  const faltan = requeridas.filter((r) => !columnas.includes(r));
  // Se dicen TODAS las que faltan, no la primera: quien arma el archivo lo corrige de una vez
  // en vez de subirlo tres veces.
  if (faltan.length > 0) return { tipo: "faltan_columnas", columnas: faltan };

  const filas = lineas.slice(1).map((linea) => {
    const valores = partirLinea(linea, separador);
    return Object.fromEntries(columnas.map((c, i) => [c, valores[i] ?? ""])) as FilaDeCsv;
  });
  return { tipo: "ok", filas, columnas };
}

/** Minúsculas y sin acentos: el encabezado lo escribe quien exporta y no tiene por qué saber. */
export function normalizarColumna(columna: string): string {
  return columna
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_");
}
