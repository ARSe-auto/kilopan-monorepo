#!/usr/bin/env node
// detectar-degradado.mjs — ¿el build lo escribió el modelo que el selector pidió, o otro?
//
// EL PROBLEMA (8-ago-2026, encontrado leyendo la invocación, no un incidente):
// `loop.sh` llamaba al CLI con `--model <el que eligió el selector> --fallback-model sonnet`.
// Si el modelo pedido no está disponible, o la iteración topa `--max-budget-usd`, el CLI
// baja a Sonnet SOLO y sin avisar. El commit resultante se ve idéntico a uno sano. O sea que
// un AC ruteado a Opus por ser regla dura —RLS, migración, trigger, invariante— podía
// terminar escrito por un modelo menor, que es exactamente lo que el §8 del maestro existe
// para impedir, y nadie se enteraba nunca.
//
// Esto no lo arregla solo: `loop.sh` además ya NO pasa fallback cuando el modelo pedido es
// el tope. Este script es la segunda mitad — el que mira lo que de verdad pasó.
//
// Uso:  node detectar-degradado.mjs <resultado.json> <modelo-pedido>
// Exit: 0 se usó el pedido · 4 DEGRADADO · 3 no se pudo determinar (y lo dice; no miente)
import { readFileSync } from "node:fs";

const [ruta, pedido] = process.argv.slice(2);
if (!ruta || !pedido) {
  console.error("uso: detectar-degradado.mjs <resultado.json> <modelo-pedido>");
  process.exit(2);
}

let crudo;
try {
  crudo = readFileSync(ruta, "utf8");
} catch {
  console.log(`degradado: INDETERMINADO — no se pudo leer ${ruta}`);
  process.exit(3);
}
if (!crudo.trim()) {
  console.log(`degradado: INDETERMINADO — ${ruta} está vacío (la corrida no llegó a escribir nada)`);
  process.exit(3);
}

// Se buscan ids de modelo en TODO el JSON en vez de en un campo fijo: el formato de salida
// del CLI cambia entre versiones, y un detector atado a `modelUsage` se rompería en silencio
// justo como el problema que vino a detectar. Cualquier `claude-*` que aparezca sirve.
const encontrados = [...new Set(crudo.match(/claude-[a-z0-9][a-z0-9-]*/g) ?? [])];

if (encontrados.length === 0) {
  console.log(
    `degradado: INDETERMINADO — el resultado no nombra ningún modelo. ` +
      `Se pidió ${pedido}; no hay forma de saber cuál respondió.`,
  );
  process.exit(3);
}

// Normaliza para que `claude-opus-5` y un snapshot fechado `claude-opus-5-20260101` cuenten
// como el mismo modelo: lo que importa es la familia y la generación, no el sufijo de fecha.
const familia = (id) => id.replace(/-\d{8}$/, "");
const pedidoN = familia(pedido);
const usados = encontrados.map(familia);

if (usados.includes(pedidoN)) {
  console.log(`degradado: no — respondió el modelo pedido (${pedidoN})`);
  process.exit(0);
}

console.error(
  `DEGRADADO: se pidió ${pedidoN} y el resultado solo menciona ${usados.join(", ")}. ` +
    `Un AC ruteado al modelo tope construido por otro no cumple el §8: la iteración NO cuenta.`,
);
process.exit(4);
