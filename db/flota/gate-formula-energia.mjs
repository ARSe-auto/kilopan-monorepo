#!/usr/bin/env node
// gate-formula-energia.mjs — la fórmula de energía vive en UN archivo. [AC-FVEH-09]
//
// El §0 pide la fórmula «en un solo lugar, familia canónica con grep-gate». `gate-constantes`
// vigila los VALORES (0,85; 15; 30/20/15/10); este vigila la ARITMÉTICA, que es la mitad que
// de verdad se rompe: nadie copia el 0,85 a mano —el otro gate lo atrapa—, pero cualquiera
// escribe `autonomia * soh * factor` en la pantalla que está armando, y a partir de ahí hay
// dos fórmulas.
//
// EL DEFECTO QUE PREVIENE TIENE NOMBRE: restar la reserva dos veces. Alguien calcula el rango
// y le resta el margen «para estar seguro»; el semáforo vuelve a restarlo porque el §0 dice
// que ahí va. El vehículo aparece «sin alcance» con media batería, el operador aprende a
// ignorar el semáforo, y el día que el semáforo tiene razón nadie le hace caso.
//
// CÓMO DECIDE. Busca, fuera del archivo canónico, líneas donde un símbolo de la familia
// —autonomía nominal, SOH, factor de consumo, reserva, rango efectivo, max_distance— aparece
// junto a un operador aritmético. Nombrar el símbolo está permitido en todas partes: una
// columna en el DDL, un campo en un JSON, una aserción en un test. Lo que no está permitido es
// OPERAR con él.
//
// Uso: node db/flota/gate-formula-energia.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 la fórmula aparece fuera de su archivo, o el archivo canónico no está.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** El único archivo donde la aritmética de energía puede vivir. */
export const CANONICO = "packages/nucleo-comun/src/energia.ts";

/**
 * Los archivos que pueden NOMBRAR y OPERAR la familia sin ser el canónico:
 *  · su propia suite de mutantes, que no podría probar la fórmula sin escribirla;
 *  · este gate, que para buscar los símbolos tiene que nombrarlos;
 *  · los mutantes de este gate, que plantan el defecto a propósito para verificar que dispara.
 *
 * La tercera exención es la incómoda y por eso se explica: las muestras de esos mutantes son
 * SINTAXIS, no valores, y armarlas por concatenación para esquivar este mismo grep habría
 * dejado un test ilegible probando un gate que existe para que el código sea legible. Lo que
 * sostiene que la lista de símbolos sirva de verdad es otra cosa, y está en ese archivo: un
 * caso que arma una expresión POR CADA símbolo en tiempo de ejecución y exige que dispare.
 */
const EXENTOS = new Set([
  CANONICO,
  "packages/nucleo-comun/src/energia.test.ts",
  "db/flota/gate-formula-energia.mjs",
  "db/flota/gate-formula-energia.test.mjs",
]);

const ARBOLES = ["apps/flota", "db/flota", "db/migraciones-flota", "packages/nucleo-comun", "packages/miga"];
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);
const esArtefacto = (nombre) => IGNORAR.has(nombre) || nombre.startsWith(".next");

/** Los símbolos de la familia, en sus dos convenciones de nombre (SQL y TypeScript). */
export const SIMBOLOS = [
  "autonomia_nominal_km",
  "autonomiaNominalKm",
  "soh_pct",
  "sohPct",
  "factor_consumo",
  "factorConsumo",
  "reserva_pct",
  "reservaPct",
  "reserva_km",
  "reservaKm",
  "rango_efectivo",
  "rangoEfectivo",
  "max_distance",
  "maxDistance",
];

/**
 * Vacía los comentarios de BLOQUE conservando los saltos de línea, para que los números de
 * línea sigan siendo los del archivo.
 *
 * Sin esto el gate se disparaba con su propia documentación: el `constants.ts` escribe la
 * fórmula en un bloque `/**` para explicarla, y explicar la fórmula en el archivo que la
 * define no es implementarla dos veces. Un guard que castiga documentar es un guard que
 * alguien apaga a la semana.
 */
export function sinComentariosDeBloque(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "));
}

/**
 * ¿Esta línea OPERA con la familia, o solo la nombra?
 *
 * Opera si el símbolo tiene a un lado un `*`, un `/` o un `-` de resta. Se excluyen las
 * apariciones dentro de un identificador más largo con guion —`reserva_km_total`— y las de un
 * comentario, que son prosa y no código.
 */
export function operaConLaFamilia(linea) {
  const sinComentario = linea.replace(/--.*$/, "").replace(/\/\/.*$/, "");
  for (const simbolo of SIMBOLOS) {
    const patron = new RegExp(
      String.raw`(?:[*/]\s*|\s-\s*)${simbolo}\b|\b${simbolo}\s*(?:[*/]|\s-\s)`,
      "",
    );
    if (patron.test(sinComentario)) return simbolo;
  }
  return null;
}

function archivos(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (esArtefacto(entrada)) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

let fallo = false;
const problemas = [];
let revisados = 0;

if (!existsSync(join(RAIZ, CANONICO))) {
  // Verde vacuo prohibido: sin el archivo canónico este gate no vigilaría nada y pasaría en
  // verde justo el día que alguien lo borra.
  problemas.push(`falta el archivo canónico de la fórmula (${CANONICO}): el gate no vigilaría nada`);
  fallo = true;
}

for (const arbol of ARBOLES) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    const rel = relative(RAIZ, ruta);
    if (EXENTOS.has(rel)) continue;
    revisados++;
    const lineas = sinComentariosDeBloque(readFileSync(ruta, "utf8")).split("\n");
    lineas.forEach((linea, i) => {
      const simbolo = operaConLaFamilia(linea);
      if (simbolo) {
        problemas.push(
          `${rel}:${i + 1} opera con «${simbolo}» fuera de ${CANONICO} — ` +
            "la fórmula de energía vive en UN solo lugar (§0): importala de ahí",
        );
        fallo = true;
      }
    });
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-formula-energia: ${SIMBOLOS.length} símbolos × ${revisados} archivos en ${ARBOLES.join(", ")} · ` +
    `${problemas.length} usos fuera del canónico`,
);
if (fallo) {
  console.error("gate-formula-energia: ROJO");
  process.exit(1);
}
console.log("gate-formula-energia: VERDE");
