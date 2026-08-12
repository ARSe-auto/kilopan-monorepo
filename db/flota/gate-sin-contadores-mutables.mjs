#!/usr/bin/env node
// gate-sin-contadores-mutables.mjs — el estado visible de una parada es PROYECCIÓN de `eventos`,
// jamás una columna que alguien actualiza a mano. [AC-FPOD-21]
//
// El §4.6 y el §2 lo piden literal: «el estado visible es proyección, jamás contadores
// mutables». `paradas.estado`/`resultado` (0037) existen y nacen `pending`, pero la 0037 ya
// dice por qué no las mueve la planificación: las transiciones de terreno son de este módulo, y
// este módulo las escribe recalculando desde `eventos` en cada lectura
// (`dominio/proyeccion-parada.ts::proyectarEstadoDeParada`,
// `servidor/paradas.ts::estadoVisibleDeParada`) — nunca con un `UPDATE paradas SET estado = …`.
//
// ─── POR QUÉ ESTO TIENE QUE SER UN GATE Y NO UNA REGLA ESCRITA ────────────────────
//
// Porque el día que el dashboard necesite ver «la parada está entregada» más rápido, la
// tentación correcta-a-primera-vista es cachear el resultado en la propia fila con un UPDATE
// después de `registrarEvento`. Eso reintroduce exactamente el bug que este AC cierra: dos
// capturas con `event_time` invertido (drift, offline) escribirían la columna en el orden en
// que el código las procese, no en el orden autoritativo del servidor — y la primera vez que
// alguien reordene ese código, el estado visible queda mintiendo sobre cuál captura es la
// vigente, en silencio, porque la captura de origen sí aterrizó bien (2xx, §4.2).
//
// Por eso el gate no busca la palabra «proyección»: busca el UPDATE mismo, sobre las DOS
// columnas que el §4.6 declara visibles (`estado`, `resultado`) de la tabla `paradas`.
//
// Uso: node db/flota/gate-sin-contadores-mutables.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 apareció un UPDATE que muta el estado visible de `paradas`.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** Las columnas del §4.6 que son «estado visible» y por eso jamás se mutan a mano. */
export const COLUMNAS_VISIBLES = ["estado", "resultado"];

/** Dónde puede aparecer un UPDATE de producción: el servidor y las rutas HTTP que despacha. */
export const ARBOLES = ["apps/flota/src/servidor", "apps/flota/src/app/api"];

const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);

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
 * Quita comentarios de JS/TS.
 *
 * Explicar POR QUÉ `paradas.estado` no se toca a mano es exactamente lo que hacen este archivo y
 * la 0037 — un gate que muerde al documentar enseña a dejar de documentar.
 */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Los `UPDATE paradas SET …` de este texto que tocan una columna visible, con su línea
 * 1-indexada. Se corta el SET en el próximo `where` (o el fin del texto): así una columna
 * mencionada en el WHERE de la MISMA sentencia —`resultado is null`, por ejemplo— no cuenta como
 * mutación, solo lo que está del lado del SET.
 */
export function mutacionesEn(texto) {
  const vivo = sinComentarios(texto);
  const hallazgos = [];
  const regex = /update\s+paradas\s+set([\s\S]*?)(\bwhere\b|$)/gi;
  let m;
  while ((m = regex.exec(vivo))) {
    const set = m[1];
    for (const columna of COLUMNAS_VISIBLES) {
      if (new RegExp(`\\b${columna}\\s*=`).test(set)) {
        const linea = vivo.slice(0, m.index).split("\n").length;
        hallazgos.push({ linea, columna });
      }
    }
  }
  return hallazgos;
}

let fallo = false;
const problemas = [];
let revisados = 0;

for (const arbol of ARBOLES) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    revisados++;
    const rel = relative(RAIZ, ruta);
    for (const { linea, columna } of mutacionesEn(readFileSync(ruta, "utf8"))) {
      problemas.push(
        `${rel}:${linea} hace UPDATE de paradas.${columna}: el estado visible es proyección de ` +
          `eventos append-only, jamás una columna que el código mantiene al día (§4.6, §2, ` +
          "AC-FPOD-21). Léela con `servidor/paradas.ts::estadoVisibleDeParada`.",
      );
      fallo = true;
    }
  }
}

// El positivo: las columnas tienen que SEGUIR existiendo en el DDL como lo que son —el punto de
// partida `pending` del que la proyección arranca cuando `eventos` todavía no tiene nada—, o el
// gate estaría vigilando un UPDATE que ya no podría escribirse por otra razón y el verde sería
// vacuo.
const ddl = join(RAIZ, "db/migraciones-flota/tenant/0037_rutas_paradas_e_items.sql");
if (!existsSync(ddl)) {
  problemas.push("falta 0037_rutas_paradas_e_items.sql: el gate no puede verificar que las columnas sigan ahí");
  fallo = true;
} else {
  const texto = readFileSync(ddl, "utf8");
  for (const columna of COLUMNAS_VISIBLES) {
    if (!new RegExp(`\\b${columna}\\s+parada_(estado|resultado)\\b`).test(texto)) {
      problemas.push(`0037 ya no declara la columna paradas.${columna}: el gate quedaría vacuo`);
      fallo = true;
    }
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-sin-contadores-mutables: paradas.{${COLUMNAS_VISIBLES.join(",")}} × ${revisados} archivos · ` +
    `${problemas.length} problemas`,
);
if (revisados === 0) {
  console.log("gate-sin-contadores-mutables: SIN ÁRBOL DE CÓDIGO — no se verificó ningún archivo");
}
if (fallo) {
  console.error("gate-sin-contadores-mutables: ROJO");
  process.exit(1);
}
console.log("gate-sin-contadores-mutables: VERDE");
