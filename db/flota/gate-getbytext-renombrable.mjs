#!/usr/bin/env node
// gate-getbytext-renombrable.mjs — el lint del §5.1/§9.2 que AC-FMIG-04 exige: selectores de
// e2e SOLO por `data-testid`/`term_key`, JAMÁS por el texto visible de un término RENOMBRABLE
// (uno que vive en `packages/miga/src/terminologia.ts` y que por lo tanto puede cambiar por
// tenant/vertical, AC-FMIG-04). Un `getByText("parada")` se rompe el día que un tenant
// renombra «parada» — y ese día el test se pone rojo por una razón que no tiene nada que ver
// con lo que de verdad se quería probar. Caso de rebote del AC: «PR con getByText sobre un
// renombrable ⇒ lint rojo».
//
// QUÉ NO VETA: `getByText` sobre texto FIJO de plataforma (botones, mensajes de estado,
// nombres de fixture) sigue permitido — solo se vigila el catálogo cerrado de términos
// renombrables, jamás cualquier uso de `getByText`. Vetar la función entera sería más ancho
// que lo que el AC pide y rompería suites de otros ACs que no tienen nada que ver con
// terminología.
//
// ALCANCE DECLARADO (nunca silencioso): `apps/flota/e2e/**/*.spec.ts` — ahí es donde se
// escriben los selectores de e2e.
//
// Uso: node db/flota/gate-getbytext-renombrable.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 algún getByText sobre un renombrable.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { TERMINOLOGIA_BASE_ES_CL } from "../../packages/miga/src/terminologia.ts";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

const ARBOL = "apps/flota/e2e";
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);

// El catálogo cerrado de renombrables: singular y plural de CADA term_key, normalizados.
const RENOMBRABLES = new Set();
for (const { singular, plural } of Object.values(TERMINOLOGIA_BASE_ES_CL)) {
  RENOMBRABLES.add(singular.trim().toLowerCase());
  RENOMBRABLES.add(plural.trim().toLowerCase());
}

// Captura `getByText(` seguido de un literal de comillas simples/dobles/backtick SIN
// interpolación — un backtick con `${` no es un literal estático y no se puede evaluar acá.
const PATRON_GETBYTEXT = /getByText\(\s*(["'`])((?:(?!\1).)*)\1/g;

let fallo = false;
const err = (msg) => {
  console.error(`GATE: ${msg}`);
  fallo = true;
};

const archivos = [];
const recorrer = (dir) => {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return;
  }
  for (const entrada of entradas) {
    if (IGNORAR.has(entrada)) continue;
    const ruta = join(dir, entrada);
    let st;
    try {
      st = statSync(ruta);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      recorrer(ruta);
      continue;
    }
    if (entrada.endsWith(".spec.ts")) archivos.push(relative(RAIZ, ruta));
  }
};
const d = join(RAIZ, ARBOL);
if (existsSync(d)) recorrer(d);

let hallazgos = 0;
for (const rel of archivos) {
  const texto = readFileSync(join(RAIZ, rel), "utf8");
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    for (const m of linea.matchAll(PATRON_GETBYTEXT)) {
      const literal = m[2];
      if (literal.includes("${")) continue; // interpolado: no es un literal estático
      if (RENOMBRABLES.has(literal.trim().toLowerCase())) {
        hallazgos++;
        err(
          `${rel}:${i + 1} usa getByText(«${literal}») sobre un término RENOMBRABLE — ` +
            `selectores de e2e SOLO por data-testid/term_key (§5.1, AC-FMIG-04)\n        ${linea.trim().slice(0, 110)}`,
        );
      }
    }
  }
}

console.log(
  `gate-getbytext-renombrable: ${archivos.length} spec(s) en ${ARBOL} · ${RENOMBRABLES.size} término(s) renombrable(s) vigilado(s) · ${hallazgos} hallazgo(s)`,
);

if (fallo) {
  console.error("gate-getbytext-renombrable: ROJO");
  process.exit(1);
}
console.log("gate-getbytext-renombrable: VERDE");
