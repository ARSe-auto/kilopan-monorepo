#!/usr/bin/env node
// gate-covering-array-parada.mjs — «archivo PICT versionado; agregar un flag sin regenerarlo
// ⇒ gate rojo» [AC-FPOD-18].
//
// Recalcula el covering array desde `covering-array-parada.pict`, tal como está HOY en el
// árbol, y lo compara —documento completo, hash de la fuente incluido— contra el `.json`
// comiteado que `apps/flota/e2e/pod-covering-array-parada.spec.ts` consume. Cualquier
// diferencia (un factor nuevo, un valor agregado, una restricción tocada, o simplemente
// alguien editando el `.json` a mano) es EXACTAMENTE el caso que el texto del AC pone en rojo:
// el array que el e2e ejerce dejó de ser el que el `.pict` describe.
//
// Uso: node db/flota/gate-covering-array-parada.mjs
// Exit: 0 verde · 1 desincronizado (con el comando que lo arregla).
import { readFileSync, existsSync } from "node:fs";
import { RUTA_PICT, RUTA_GENERADO, generarDocumento } from "./generar-covering-array.mjs";

if (!existsSync(RUTA_PICT)) {
  console.error(`GATE: falta ${RUTA_PICT}`);
  process.exit(1);
}

const textoPict = readFileSync(RUTA_PICT, "utf8");
const recienGenerado = generarDocumento(textoPict);

if (!existsSync(RUTA_GENERADO)) {
  console.error(
    `GATE: falta ${RUTA_GENERADO} — corré 'node db/flota/generar-covering-array.mjs' y comiteá el resultado.`,
  );
  process.exit(1);
}

const comiteado = JSON.parse(readFileSync(RUTA_GENERADO, "utf8"));
const igual = JSON.stringify(comiteado) === JSON.stringify(recienGenerado);

if (!igual) {
  console.error(
    "GATE: covering-array-parada.generado.json está DESINCRONIZADO de covering-array-parada.pict " +
      "(un factor, un valor o una restricción cambió sin regenerar el array — AC-FPOD-18).",
  );
  if (comiteado.shaPict !== recienGenerado.shaPict) {
    console.error(`  sha de la fuente: comiteado=${comiteado.shaPict} actual=${recienGenerado.shaPict}`);
  }
  if (comiteado.filas?.length !== recienGenerado.filas.length) {
    console.error(`  filas: comiteadas=${comiteado.filas?.length ?? "?"} recién generadas=${recienGenerado.filas.length}`);
  }
  console.error("  arreglo: node db/flota/generar-covering-array.mjs && git add db/flota/covering-array-parada.generado.json");
  process.exit(1);
}

console.log(
  `gate-covering-array-parada: ${recienGenerado.filas.length} filas · ${recienGenerado.totalParesRequeridos} pares · sincronizado`,
);
console.log("gate-covering-array-parada: VERDE");
