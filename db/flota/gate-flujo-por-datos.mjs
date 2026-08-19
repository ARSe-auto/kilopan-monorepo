#!/usr/bin/env node
// gate-flujo-por-datos.mjs — cero condicionales por vertical en la UI de terreno. [AC-FMIG-15]
//
// El §4.6 dice que el flujo del operario se ARMA POR DATOS: `stop_requirement` se deriva del
// `cargo_type` de la carga (la copia vive en `derivarRequisitos`, `apps/flota/src/servidor/
// rutas.ts`, invocada al publicar el día), y la pantalla de terreno solo mira esas filas — jamás
// pregunta de qué vertical es el tenant. Es lo que hace que «activar un vertical = INSERT de
// filas» (§2 métrica 4) no sea una mentira: si la UI ramificara por el NOMBRE de un vertical, un
// vertical nuevo volvería a exigir código, no solo filas.
//
// El diseño de HOY ya cumple esto —es un invariante, no una promesa—, y este gate existe para
// que SIGA cumpliéndolo: sin un chequeo mecánico, el día que alguien apurado escriba
// `if (vertical === 'panaderia')` en una pantalla, nada lo va a atrapar hasta que un tenant de
// otro vertical vea comportamiento ajeno.
//
// Lo que el gate NO persigue: el string «vertical» a secas (aparece legítimo como nombre de
// parámetro que se reenvía sin ramificar, p. ej. `sembrarMotivos(pool, vertical)`) ni una
// validación de forma («vertical === ''», que es «¿vino el parámetro?», no «¿de qué vertical
// es?»). Persigue la comparación contra el NOMBRE de un vertical concreto — la lista viva de
// `VERTICALES_DEMO` en `db/flota/wizard-onboarding.mjs`, el único catálogo de verticales de E1.
//
// Uso: node db/flota/gate-flujo-por-datos.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 alguien ramificó la UI por el nombre de un vertical.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** Dónde vive el catálogo VIVO de verticales de E1 — la Pregunta al dueño 10 lo mantiene en
 *  UNA sola entrada hoy, pero el gate no asume el número: lee las claves del objeto. */
export const DONDE_VIVE_EL_CATALOGO = "db/flota/wizard-onboarding.mjs";

/** El árbol de pantallas y de dominio de terreno: donde una ramificación por vertical le pega
 *  directo al operario. `servidor` entra porque ahí vive la derivación real (`rutas.ts`) y es
 *  donde el §4.6 la pone por escrito. */
export const ARBOL_DE_FLUJO = [
  "apps/flota/src/app",
  "apps/flota/src/dominio",
  "apps/flota/src/servidor",
];

const EXTENSIONES = /\.(ts|tsx)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);
const esArtefacto = (n) => IGNORAR.has(n) || n.startsWith(".next");

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

/** Quita comentarios de TS — nombrar un vertical para explicar por qué NO se ramifica por él es
 *  legítimo (varios archivos de este árbol ya lo hacen). */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Las claves de `VERTICALES_DEMO` en el wizard: el catálogo VIVO de nombres de vertical de E1. */
export function catalogoDeVerticales(raiz = RAIZ) {
  const ruta = join(raiz, DONDE_VIVE_EL_CATALOGO);
  if (!existsSync(ruta)) return [];
  const texto = readFileSync(ruta, "utf8");
  const inicio = texto.indexOf("VERTICALES_DEMO");
  if (inicio === -1) return [];
  const cuerpo = texto.slice(inicio, texto.indexOf("\n};", inicio) + 3);
  return [...cuerpo.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
}

/**
 * ¿Este archivo ramifica por el NOMBRE de un vertical? Detecta comparaciones (`===`, `==`) y
 * `switch`/`case` contra el literal de un vertical del catálogo — no el mero uso de la palabra
 * «vertical» como identificador, que es dato y no condicional.
 */
export function condicionalesEn(texto, catalogo) {
  const vivo = sinComentarios(texto);
  const ofensoras = [];
  vivo.split("\n").forEach((linea, i) => {
    for (const v of catalogo) {
      const literal = String.raw`['"\`]${v}['"\`]`;
      const patron = new RegExp(
        `(===|==)\\s*${literal}|${literal}\\s*(===|==)|case\\s+${literal}\\s*:`,
      );
      if (patron.test(linea)) ofensoras.push({ linea: i + 1, vertical: v });
    }
  });
  return ofensoras;
}

const catalogo = catalogoDeVerticales();
let fallo = false;
const problemas = [];
let revisados = 0;

if (catalogo.length === 0) {
  console.error(
    `GATE: no pude leer el catálogo de verticales desde ${DONDE_VIVE_EL_CATALOGO} — sin él el ` +
      "gate no puede verificar nada (verde vacuo evitado)",
  );
  fallo = true;
}

for (const arbol of ARBOL_DE_FLUJO) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    revisados++;
    const rel = relative(RAIZ, ruta);
    for (const { linea, vertical } of condicionalesEn(readFileSync(ruta, "utf8"), catalogo)) {
      problemas.push(
        `${rel}:${linea} compara contra el vertical «${vertical}»: el flujo del operario se ` +
          `arma POR DATOS (\`stop_requirement\` derivado de \`cargo_type\`), jamás por el ` +
          "nombre del vertical del tenant (§4.6, §4.9)",
      );
      fallo = true;
    }
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-flujo-por-datos: catálogo ${catalogo.join(", ") || "(vacío)"} × ${revisados} archivos ` +
    `de flujo · ${problemas.length} problemas`,
);
if (revisados === 0) {
  console.log("gate-flujo-por-datos: SIN ÁRBOL DE FLUJO — no se verificó ninguna pantalla");
}
if (fallo) {
  console.error("gate-flujo-por-datos: ROJO");
  process.exit(1);
}
console.log("gate-flujo-por-datos: VERDE");
