#!/usr/bin/env node
// gate-seeds-pin-destinatario.mjs — el gancho que existe en el DDL y NADIE siembra. [AC-FRUT-20]
//
// El §4.9 pone `pin_destinatario` entre los ganchos VIVOS: el valor está en el enum
// `evidencia_tipo` desde el día 1 y `stop_requirement` lo acepta. Pero el §5.2 F4 es explícito en
// que en E1 NINGÚN seed lo siembra — la evidencia extra solo aparece «si stop_requirement la
// exige», y en E1 no la exige nadie.
//
// ─── POR QUÉ ESTO NO LO PUEDE PROBAR UN TEST DE BASE ─────────────────────────────────
//
// Un test que cuente filas en la base de un fixture prueba que ESA base está limpia hoy. Lo que
// se pierde es más silencioso: alguien agrega el requisito a la plantilla de un vertical, o a un
// seed de `cargo_type_requirement`, y desde ahí la derivación del publicar (AC-FRUT-04) lo copia
// a TODAS las paradas de ese tipo de carga. El día que eso pase, el operario del andén se
// encuentra pidiéndole un PIN al destinatario en una entrega de pan — y el PIN del destinatario
// es un mecanismo de E2 que nadie configuró, así que la parada no se puede cerrar.
//
// La pérdida entra por el SEED y no por el DDL, y por eso este chequeo mira los seeds. Es propio
// y separado de la conducta de agrupación a propósito (§9.2: un AC por commit).
//
// ─── Y EL POSITIVO, PARA QUE EL VERDE NO SEA VACUO ──────────────────────────────────
//
// «Nadie lo siembra» lo cumpliría también un repo donde el valor no existe — y eso sería el
// error opuesto: el §4.9 exige que el gancho esté VIVO en el esquema para que activarlo en E2
// sean filas y no una migración. Por eso el gate exige además que el valor SÍ esté en el enum
// del DDL, y se pone rojo si desapareciera.
//
// Uso: node db/flota/gate-seeds-pin-destinatario.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 alguien lo sembró, o el gancho se cayó del DDL.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** El gancho del §4.9 que en E1 es solo DDL (§5.2 F4). */
export const GANCHO = "pin_destinatario";

/** Donde el valor TIENE que estar: el enum del §4.6 que `stop_requirement` y `evidence` usan. */
export const DONDE_VIVE = "db/migraciones-flota/tenant/0002_hechos_evidencia_y_revision.sql";

/**
 * Dónde puede entrar una siembra. Son los caminos por los que una fila llega a un TENANT: una
 * migración que la escribe, un fixture que la prepara, una plantilla de vertical, o el servidor
 * que la deriva.
 *
 * `db/flota/pgtap` queda FUERA a propósito y está dicho acá para que nadie lo lea como un olvido:
 * esas suites corren contra `t_canary` dentro de una transacción que se deshace, y una de ellas
 * inserta el requisito a propósito —es como se ejerce que el gancho está vivo y la tabla lo
 * acepta de verdad (§4.9)—. Ninguna de sus filas sobrevive ni llega a un tenant.
 */
export const ARBOLES_DE_SIEMBRA = [
  "db/migraciones-flota",
  "db/flota/seeds",
  "apps/flota/e2e",
  "apps/flota/src/servidor",
];

const EXTENSIONES = /\.(sql|mjs|ts|tsx|json)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);

/** Las tablas cuya siembra importa: de acá sale lo que el operario ve en la parada. */
export const TABLAS_SEMBRABLES = ["stop_requirement", "cargo_type_requirement"];

function archivos(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (IGNORAR.has(entrada) || entrada.startsWith(".next")) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

/**
 * Quita comentarios de SQL y de JS.
 *
 * Nombrar el gancho para explicar POR QUÉ no está sembrado es legítimo y necesario — la 0002 lo
 * documenta y esta misma familia de archivos lo cita. Lo que el gate persigue es la cadena en
 * código VIVO.
 */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/--.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n");
}

/** ¿Este archivo siembra el gancho? Devuelve las líneas ofensoras, 1-indexadas. */
export function siembrasEn(texto) {
  const vivo = sinComentarios(texto);
  const ofensoras = [];
  vivo.split("\n").forEach((linea, i) => {
    if (new RegExp(`['"\`]${GANCHO}['"\`]`).test(linea)) ofensoras.push(i + 1);
  });
  return ofensoras;
}

let fallo = false;
const problemas = [];
let revisados = 0;

for (const arbol of ARBOLES_DE_SIEMBRA) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    revisados++;
    const rel = relative(RAIZ, ruta);
    // El propio enum del DDL nombra el valor: es donde TIENE que estar.
    if (rel === DONDE_VIVE) continue;
    for (const linea of siembrasEn(readFileSync(ruta, "utf8"))) {
      problemas.push(
        `${rel}:${linea} siembra «${GANCHO}»: en E1 ese gancho es DDL-only y ningún seed lo ` +
          `pone (§5.2 F4, §4.9). Si de verdad llegó su momento, es E2 y se decide con el dueño`,
      );
      fallo = true;
    }
  }
}

// El positivo: el gancho tiene que SEGUIR en el enum. Sin esto, borrar el valor del DDL pondría
// este gate en verde — y sería el error opuesto, porque activarlo en E2 volvería a ser una
// migración en vez de filas.
const ddl = join(RAIZ, DONDE_VIVE);
if (!existsSync(ddl)) {
  problemas.push(`falta ${DONDE_VIVE}: el gate no puede verificar que el gancho siga VIVO`);
  fallo = true;
} else if (!new RegExp(`['"]${GANCHO}['"]`).test(readFileSync(ddl, "utf8"))) {
  problemas.push(
    `${DONDE_VIVE} ya no declara «${GANCHO}» en el enum de evidencia: el §4.9 lo quiere VIVO ` +
      "en el esquema para que encenderlo en E2 sean filas y no una migración",
  );
  fallo = true;
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-seeds-pin-destinatario: «${GANCHO}» × ${revisados} archivos de siembra ` +
    `(${TABLAS_SEMBRABLES.join(", ")}) · ${problemas.length} problemas`,
);
if (revisados === 0) {
  console.log("gate-seeds-pin-destinatario: SIN ÁRBOLES DE SIEMBRA — no se verificó ningún seed");
}
if (fallo) {
  console.error("gate-seeds-pin-destinatario: ROJO");
  process.exit(1);
}
console.log("gate-seeds-pin-destinatario: VERDE");
