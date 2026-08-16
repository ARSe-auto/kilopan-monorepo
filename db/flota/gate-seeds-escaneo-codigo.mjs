#!/usr/bin/env node
// gate-seeds-escaneo-codigo.mjs — el gancho que existe en el DDL y NADIE siembra. [AC-FPOD-17]
//
// El §4.9 pone `escaneo_codigo` entre los ganchos VIVOS: el valor está en el enum
// `evidencia_tipo` desde el día 1 y `stop_requirement` lo acepta. Pero el §5.2 F4 / §3.E3 son
// explícitos en que en E1 NINGÚN seed lo siembra — la evidencia extra solo aparece «si
// stop_requirement la exige», y en E1 no la exige nadie: el escaneo de código es E3.
//
// Mismo criterio, mismo riesgo y mismo remedio que `gate-seeds-pin-destinatario.mjs`
// (AC-FRUT-20), que ya cubre el gancho hermano del mismo enum — un AC por commit (§9.2) es la
// razón de que este archivo sea propio y no una extensión del de al lado: extender el otro
// obligaría a tocar su gate y su test de mutantes, que son de un AC ajeno.
//
// Uso: node db/flota/gate-seeds-escaneo-codigo.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 alguien lo sembró, o el gancho se cayó del DDL.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** El gancho del §4.9 que en E1 es solo DDL (§5.2 F4, §3.E3). */
export const GANCHO = "escaneo_codigo";

/** Donde el valor TIENE que estar: el enum del §4.6 que `stop_requirement` y `evidence` usan. */
export const DONDE_VIVE = "db/migraciones-flota/tenant/0002_hechos_evidencia_y_revision.sql";

/**
 * Dónde puede entrar una siembra. Son los caminos por los que una fila llega a un TENANT: una
 * migración que la escribe, un fixture que la prepara, una plantilla de vertical, o el servidor
 * que la deriva.
 *
 * `db/flota/pgtap` queda FUERA a propósito, mismo motivo que su gancho hermano: esas suites
 * corren contra `t_canary` dentro de una transacción que se deshace y ninguna de sus filas
 * sobrevive ni llega a un tenant.
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
          `pone (§5.2 F4, §3.E3, §4.9). Si de verdad llegó su momento, es E3 y se decide con el dueño`,
      );
      fallo = true;
    }
  }
}

// El positivo: el gancho tiene que SEGUIR en el enum. Sin esto, borrar el valor del DDL pondría
// este gate en verde — y sería el error opuesto, porque activarlo en E3 volvería a ser una
// migración en vez de filas.
const ddl = join(RAIZ, DONDE_VIVE);
if (!existsSync(ddl)) {
  problemas.push(`falta ${DONDE_VIVE}: el gate no puede verificar que el gancho siga VIVO`);
  fallo = true;
} else if (!new RegExp(`['"]${GANCHO}['"]`).test(readFileSync(ddl, "utf8"))) {
  problemas.push(
    `${DONDE_VIVE} ya no declara «${GANCHO}» en el enum de evidencia: el §4.9 lo quiere VIVO ` +
      "en el esquema para que encenderlo en E3 sean filas y no una migración",
  );
  fallo = true;
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-seeds-escaneo-codigo: «${GANCHO}» × ${revisados} archivos de siembra ` +
    `(${TABLAS_SEMBRABLES.join(", ")}) · ${problemas.length} problemas`,
);
if (revisados === 0) {
  console.log("gate-seeds-escaneo-codigo: SIN ÁRBOLES DE SIEMBRA — no se verificó ningún seed");
}
if (fallo) {
  console.error("gate-seeds-escaneo-codigo: ROJO");
  process.exit(1);
}
console.log("gate-seeds-escaneo-codigo: VERDE");
