#!/usr/bin/env node
// Genera `packages/nucleo-comun/constants.md` desde `src/constants.ts` (§0: «constants.ts +
// constants.md generado»). El .md NO se edita a mano: es la vista legible de la familia, y
// un test falla si quedó desactualizado respecto del .ts.
//
// Uso: node packages/nucleo-comun/scripts/generar-constants-md.mjs [--verificar]
//   sin flag     escribe constants.md
//   --verificar  no escribe; sale 1 si el archivo en disco no coincide con lo generado
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAQUETE = join(AQUI, "..");
const DESTINO = join(PAQUETE, "constants.md");
const FUENTE = join(PAQUETE, "src/constants.ts");

const constantes = await import(`file://${FUENTE}`);

/** Extrae el comentario de bloque o de línea que precede a cada `export const NOMBRE`. */
function comentariosDelFuente() {
  const texto = readFileSync(FUENTE, "utf8");
  const mapa = new Map();
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^export const ([A-Z_0-9]+)/);
    if (!m) continue;
    const glosa = [];
    for (let j = i - 1; j >= 0; j--) {
      const l = lineas[j].trim();
      if (l.startsWith("*/") || l.startsWith("*") || l.startsWith("/**") || l.startsWith("//")) {
        glosa.unshift(l.replace(/^\/\*\*|^\*\/$|^\*\s?|^\/\/\s?/g, "").trim());
      } else break;
    }
    mapa.set(m[1], glosa.filter(Boolean).join(" ").trim());
  }
  return mapa;
}

const glosas = comentariosDelFuente();

/** Renderiza un valor de forma estable (sin depender del orden de inserción del motor). */
function render(v) {
  if (Array.isArray(v)) return v.map(render).join(" · ");
  if (v && typeof v === "object") {
    return Object.entries(v)
      .map(([k, x]) => `${k} = ${render(x)}`)
      .join(" · ");
  }
  if (typeof v === "string") return `\`${v}\``;
  return String(v);
}

const filas = [];
for (const [nombre, valor] of Object.entries(constantes)) {
  if (nombre === "CIFRAS_VIGILADAS") continue; // tiene tabla propia más abajo
  filas.push(`| \`${nombre}\` | ${render(valor)} | ${glosas.get(nombre) ?? ""} |`);
}

const vigiladas = constantes.CIFRAS_VIGILADAS.map(
  (c) => `| \`${c.nombre}\` | ${render(c.valor)} | \`${c.patron}\` |`,
);

const md = `# Familia canónica de constantes — Plataforma FLOTA

<!-- GENERADO por packages/nucleo-comun/scripts/generar-constants-md.mjs. NO editar a mano:
     la fuente es packages/nucleo-comun/src/constants.ts y un test compara los dos. -->

Vista legible de \`packages/nucleo-comun/src/constants.ts\`, que es la fuente ÚNICA de la
familia del §0 del maestro para componentes Y tests. Un número mágico de esta familia
escrito fuera del archivo canónico pone el build en rojo (\`db/flota/gate-constantes.mjs\`).

## Constantes

| Grupo | Valor | Qué es |
|---|---|---|
${filas.join("\n")}

## Cifras vigiladas por el grep-gate

Lista CERRADA. Para las cifras inconfundibles el patrón es el número; para las que también
son números comunes, el patrón exige contexto — un guard que salta con cualquier \`5\` del
código se desactiva solo a la semana.

| Constante | Valor | Patrón que la delata fuera del archivo canónico |
|---|---|---|
${vigiladas.join("\n")}
`;

if (process.argv.includes("--verificar")) {
  let enDisco = "";
  try {
    enDisco = readFileSync(DESTINO, "utf8");
  } catch {
    console.error("GATE: falta constants.md — generarlo con `node packages/nucleo-comun/scripts/generar-constants-md.mjs`");
    process.exit(1);
  }
  if (enDisco !== md) {
    console.error("GATE: constants.md quedó desactualizado respecto de src/constants.ts — regenerarlo");
    process.exit(1);
  }
  console.log("constants.md: al día con src/constants.ts");
} else {
  writeFileSync(DESTINO, md);
  console.log(`constants.md generado (${filas.length} grupos · ${vigiladas.length} cifras vigiladas)`);
}
