#!/usr/bin/env node
// gate-theming-por-filas.mjs — las dos prohibiciones estáticas del §5.1 [AC-FMIG-02]:
// «theming por filas, jamás por código». Un mecanismo que PUEDE fallar (§5, encabezado), no
// una constante que solo publica.
//
//   (a) grep-gate: cero `backdrop-filter`/`-webkit-backdrop-filter` (translucidez Liquid
//       Glass) en los componentes de `packages/miga` y en las pantallas de `apps/flota`.
//   (b) regla estática: el tema entra ÚNICAMENTE como las CSS custom properties derivadas de
//       `tenant_theme` — cero columna/endpoint/archivo que acepte o sirva CSS arbitrario por
//       tenant. Se vigila por NOMBRE: un identificador que prometa "CSS libre del tenant"
//       (custom_css, css_libre, estilos_tenant, raw_css/html) es la forma en que ese agujero
//       empezaría a existir, mucho antes de que alguien lo conecte a algo.
//
// ALCANCE DECLARADO (nunca silencioso): TODO `packages/miga` (todos sus componentes son de
// terreno, §5.2) y TODO `apps/flota/src/app` salvo `api/` (las rutas HTTP no son pantallas).
// Es más ancho que «solo terreno» a propósito: ninguna pantalla de esta PWA —tampoco el panel
// admin— tiene un caso de uso legítimo para translucidez o CSS libre por tenant, y limitar el
// gate a un subárbol de pantallas sería inventar una excepción que el maestro no pide.
//
// Uso: node db/flota/gate-theming-por-filas.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 alguna de las dos prohibiciones violada.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

const ARBOLES = ["packages/miga", "apps/flota/src/app"];
const EXTENSIONES = /\.(ts|tsx|css)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git", "api"]);
const esArtefacto = (nombre) => IGNORAR.has(nombre) || nombre.startsWith(".next");

// Identificadores que solo tendrían sentido si existiera una vía de CSS libre por tenant.
const PATRON_CSS_ARBITRARIO = /\b(custom[_-]?css|css[_-]?libre|estilos?[_-]?tenant|raw[_-]?css|raw[_-]?html)\b/i;

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
    if (esArtefacto(entrada)) continue;
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
    if (!EXTENSIONES.test(entrada)) continue;
    archivos.push(relative(RAIZ, ruta));
  }
};
for (const arbol of ARBOLES) {
  const d = join(RAIZ, arbol);
  if (existsSync(d)) recorrer(d);
}

let hallazgosLiquidGlass = 0;
let hallazgosCssArbitrario = 0;
for (const rel of archivos) {
  const texto = readFileSync(join(RAIZ, rel), "utf8");
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    // `-?` porque los estilos inline de React/TSX escriben la propiedad en camelCase
    // (`backdropFilter`, `WebkitBackdropFilter`) y no en el kebab-case del CSS/`.css`.
    if (/backdrop-?filter/i.test(lineas[i])) {
      hallazgosLiquidGlass++;
      err(`${rel}:${i + 1} usa backdrop-filter (translucidez Liquid Glass, §5.1 PROHIBIDO)\n        ${lineas[i].trim().slice(0, 110)}`);
    }
    if (PATRON_CSS_ARBITRARIO.test(lineas[i])) {
      hallazgosCssArbitrario++;
      err(
        `${rel}:${i + 1} nombra un identificador de CSS arbitrario por tenant — el tema entra ÚNICAMENTE ` +
          `como las custom properties derivadas de tenant_theme (§4.4, §5.1)\n        ${lineas[i].trim().slice(0, 110)}`,
      );
    }
  }
}

console.log(
  `gate-theming-por-filas: ${archivos.length} archivo(s) en ${ARBOLES.join(", ")} (sin api/) · ` +
    `${hallazgosLiquidGlass} de Liquid Glass · ${hallazgosCssArbitrario} de CSS arbitrario`,
);

if (fallo) {
  console.error("gate-theming-por-filas: ROJO");
  process.exit(1);
}
console.log("gate-theming-por-filas: VERDE");
