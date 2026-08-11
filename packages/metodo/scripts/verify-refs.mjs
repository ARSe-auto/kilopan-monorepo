#!/usr/bin/env node
// verify-refs.mjs — las citas de AC resuelven en ambos sentidos.
//
// 1. HUÉRFANO (rojo): un [AC-XXX-NN] citado en código/tests que NINGUNA spec define.
//    Es un AC que alguien inventó al vuelo; no tiene criterio ni dueño.
// 2. SIN RESPALDO (rojo): un AC marcado [x] en specs que NADIE menciona en código ni
//    tests. Un AC cerrado que ningún archivo referencia es una afirmación sin evidencia
//    — exactamente el modo de fallo que dejó la foto del POD sin existir.
// 3. ABIERTO SIN CÓDIGO (informativo): normal, es trabajo pendiente.
//
// Uso: node verify-refs.mjs [--app=kilopan]
// Exit: 0 verde · 1 referencias rotas.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const app = argv.find((a) => a.startsWith("--app="))?.split("=")[1] ?? "kilopan";
const estricto = argv.includes("--estricto");

// `.claude` guarda worktrees de agentes en segundo plano, y un worktree es una COPIA
// ENTERA del repo: escanearlo cuenta cada AC dos veces y deja que el borrador de
// cualquier agente —un plan a medio escribir, con una cita truncada— ponga el gate en
// rojo por algo que no está en el proyecto. El contrato vive en specs/ y en el árbol
// real, no en el scratch de nadie.
const IGNORAR = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".next",
  "dist",
  "build",
  "test-results",
  "playwright-report",
  "specs",
]);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|sh|md)$/;
// El plan y la bitácora citan todos los ACs por diseño: no cuentan como respaldo.
const NO_CUENTA = /^(IMPLEMENTATION_PLAN|docs\/BITACORA|docs\/PROMPT_MAESTRO|docs\/ARRANQUE|AGENTS\.md|CLAUDE\.md|TRASPASO)/;

const dirSpecs = join(ROOT, "specs", app);
if (!existsSync(dirSpecs)) {
  console.error(`verify-refs: specs/${app}/ no existe — corré gate_specs primero.`);
  process.exit(1);
}

// --- 1. Universo de definición: qué AC define cada spec, y con qué estado
const definicionesDe = (dir) => {
  const mapa = new Map(); // id -> { estado, archivo }
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const texto = readFileSync(join(dir, f), "utf8");
    let estado = null;
    for (const linea of texto.split("\n")) {
      const inicio = linea.match(/^- \[([ x])\]/);
      if (inicio) estado = inicio[1];
      else if (/^(#|- )/.test(linea)) estado = null;
      if (estado === null) continue;
      // El ÚLTIMO corchete de la línea, no el primero — misma razón que gate_specs.mjs
      // (11-ago-2026): una cita a mitad de frase a OTRO AC, entre corchetes, se leía como
      // si esta línea definiera ESE otro id en vez del suyo propio.
      const ms = [...linea.matchAll(/\[(AC-[A-Z0-9]+-\d+)\]/g)];
      const id = ms.length ? ms[ms.length - 1][1] : undefined;
      if (id && !mapa.has(id)) mapa.set(id, { estado, archivo: f });
    }
  }
  return mapa;
};

// Definiciones de ESTA app: mandan sobre la regla 2 ([x] sin respaldo). Cada contrato
// responde por sus propios cierres, no por los del vecino.
const definidos = definicionesDe(dirSpecs);

// Definiciones de TODAS las apps: mandan sobre la regla 1 (huérfano). El árbol es UNO
// solo y el recorrido de abajo es global, pero `definidos` es de una app: con specs/flota/
// poblado, las ~100 citas legítimas de KiloPan en apps/kilopan/** aparecían huérfanas al
// correr --app=flota (y las de FLOTA al revés en cuanto apps/flota tenga código), y el
// gate de la app nueva no podía ponerse verde JAMÁS. Un AC citado es huérfano solo si
// NINGUNA spec de NINGUNA app lo define — así se sigue pillando el id inventado al vuelo,
// que es lo que esta regla protege.
const definidosGlobal = new Map(definidos);
const dirSpecsRaiz = join(ROOT, "specs");
for (const otra of readdirSync(dirSpecsRaiz)) {
  const d = join(dirSpecsRaiz, otra);
  if (otra === app || !existsSync(d) || !statSync(d).isDirectory()) continue;
  for (const [id, def] of definicionesDe(d)) {
    if (!definidosGlobal.has(id)) definidosGlobal.set(id, { ...def, app: otra });
  }
}

// --- 2. Dónde se cita cada AC fuera de las specs
const citas = new Map(); // id -> Set(archivo)
const recorrer = (dir) => {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const ruta = join(dir, entrada);
    let st;
    try { st = statSync(ruta); } catch { continue; }
    if (st.isDirectory()) { recorrer(ruta); continue; }
    if (!EXT.test(entrada)) continue;
    const rel = relative(ROOT, ruta);
    if (NO_CUENTA.test(rel)) continue;
    let texto;
    try { texto = readFileSync(ruta, "utf8"); } catch { continue; }
    for (const m of texto.matchAll(/\b(AC-[A-Z0-9]+-\d+)\b/g)) {
      if (!citas.has(m[1])) citas.set(m[1], new Set());
      citas.get(m[1]).add(rel);
    }
  }
};
recorrer(ROOT);

// --- 3. Veredicto
let fallo = false;
const huerfanos = [...citas.keys()].filter((id) => !definidosGlobal.has(id)).sort();
if (huerfanos.length) {
  fallo = true;
  console.error(`GATE: ${huerfanos.length} AC citados que ninguna spec define:`);
  for (const id of huerfanos) console.error(`  ${id} ← ${[...citas.get(id)].slice(0, 3).join(", ")}`);
}

// Fatal solo en --estricto (lo corre check.sh --full). En el gate rápido es un aviso:
// bloquear cada iteración por esto detendría el trabajo en vez de dirigirlo, pero
// callarlo dejaría pasar un "listo" sin evidencia — que es como la foto del POD llegó a
// producción sin existir. Ni fatal siempre, ni silencioso nunca.
const cerradosSinRespaldo = [...definidos.entries()]
  .filter(([id, d]) => d.estado === "x" && !citas.has(id))
  .map(([id, d]) => `${id} (${d.archivo})`)
  .sort();
if (cerradosSinRespaldo.length) {
  const etiqueta = estricto ? "GATE" : "AVISO";
  console.error(
    `${etiqueta}: ${cerradosSinRespaldo.length} AC marcados [x] que nadie menciona en código ni tests:`
  );
  for (const s of cerradosSinRespaldo) console.error(`  ${s}`);
  if (estricto) fallo = true;
  else console.error("  (con --estricto esto pone el gate en rojo; corre así en check.sh --full)");
}

const abiertos = [...definidos.values()].filter((d) => d.estado === " ").length;
console.log(
  `verify-refs [${app}]: ${definidos.size} ACs definidos · ${citas.size} citados en el árbol · ${abiertos} abiertos`
);

if (fallo) { console.error("verify-refs: ROJO"); process.exit(1); }
console.log("verify-refs: VERDE");
