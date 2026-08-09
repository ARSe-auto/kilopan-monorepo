#!/usr/bin/env node
// gate-constantes.mjs — el grep-gate del §0 [AC-FTEN-01]:
// «un número mágico de esta familia hardcodeado fuera del archivo canónico ⇒ build rojo».
//
// Hace dos cosas:
//   1. Verifica que `constants.md` esté al día con `src/constants.ts` (el .md es generado).
//   2. Busca, en el código de FLOTA, cada una de las CIFRAS_VIGILADAS declaradas en el
//      propio archivo canónico. Una coincidencia fuera de él es una copia del valor, y una
//      copia es una divergencia futura garantizada.
//
// ALCANCE DECLARADO (nunca silencioso, §10 «no silent caps»): se revisan los árboles que
// hoy son de FLOTA. `packages/miga` entró el 09-ago-2026 con AC-FMIG-01, que publica los
// tokens estructurales del §5.1 leyendo esta familia (`packages/miga/src/estructura.ts`)
// y saca de los componentes los números que antes estaban escritos a mano. El gate
// imprime siempre qué miró y qué no.
//
// Uso: node db/flota/gate-constantes.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 número mágico duplicado o constants.md desactualizado.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

const CANONICO = "packages/nucleo-comun/src/constants.ts";
const GENERADO = "packages/nucleo-comun/constants.md";

const ARBOLES = ["apps/flota", "db/flota", "db/migraciones-flota", "packages/nucleo-comun", "packages/miga"];
const PENDIENTES = [];
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs|sql|sh)$/;
const IGNORAR = new Set(["node_modules", ".next", "dist", "build", ".git"]);

const { CIFRAS_VIGILADAS } = await import(`file://${join(RAIZ, CANONICO)}`);

let fallo = false;
const err = (msg) => {
  console.error(`GATE: ${msg}`);
  fallo = true;
};

// --- 1. constants.md al día -------------------------------------------------------------
// Solo contra el repo real: con --raiz apuntando a un sandbox de pruebas no hay generador.
if (!raizArg) {
  try {
    execFileSync("node", [join(RAIZ, "packages/nucleo-comun/scripts/generar-constants-md.mjs"), "--verificar"], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (e) {
    err(`${GENERADO} no refleja ${CANONICO} — regenerarlo con el script del paquete`);
    process.stderr.write(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
}

// --- 2. La familia no se copia -----------------------------------------------------------
if (!CIFRAS_VIGILADAS?.length) {
  err("CIFRAS_VIGILADAS está vacía: el grep-gate no vigilaría nada (verde vacuo prohibido)");
}

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
    if (!EXTENSIONES.test(entrada)) continue;
    const rel = relative(RAIZ, ruta);
    if (rel === CANONICO || rel === GENERADO) continue;
    archivos.push(rel);
  }
};
for (const arbol of ARBOLES) {
  const d = join(RAIZ, arbol);
  if (existsSync(d)) recorrer(d);
}

let hallazgos = 0;
for (const cifra of CIFRAS_VIGILADAS ?? []) {
  const re = new RegExp(cifra.patron);
  for (const rel of archivos) {
    const texto = readFileSync(join(RAIZ, rel), "utf8");
    const lineas = texto.split("\n");
    for (let i = 0; i < lineas.length; i++) {
      if (!re.test(lineas[i])) continue;
      hallazgos++;
      err(
        `${rel}:${i + 1} repite ${cifra.nombre} (${cifra.valor}) — importarlo de ${CANONICO}\n` +
          `        ${lineas[i].trim().slice(0, 110)}`,
      );
    }
  }
}

console.log(
  `gate-constantes: ${CIFRAS_VIGILADAS?.length ?? 0} cifras vigiladas × ${archivos.length} archivos ` +
    `en ${ARBOLES.join(", ")} · ${hallazgos} duplicaciones`,
);
console.log(`gate-constantes: fuera del alcance por ahora → ${PENDIENTES.join(", ")}`);

if (fallo) {
  console.error("gate-constantes: ROJO");
  process.exit(1);
}
console.log("gate-constantes: VERDE");
