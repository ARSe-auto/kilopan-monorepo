#!/usr/bin/env node
// gate-capturas-sin-rechazo.mjs — «las capturas JAMÁS muestran rechazo» [AC-FMIG-10] — §5.7, §4.2.
//
// El §5.7 lo dice sin matices y es el caso de rebote del AC: de los cuatro estados obligatorios,
// el de ERROR no existe para una captura. Lo que el chofer ve de una entrega que todavía no llegó
// al servidor es «Entregada — por sincronizar» con el contador real de la cola, y nada más.
//
// ─── POR QUÉ ESTO NECESITA UN GATE Y NO ALCANZA CON UN e2e ──────────────────────────
//
// El e2e prueba el camino que hoy existe. Lo que este chequeo protege es la TENTACIÓN, que llega
// después y por el camino más razonable del mundo: alguien mira el replay, ve que un lote puede no
// llegar, y agrega «avisarle al chofer». Ese aviso es el defecto. El §4.2 reparte los papeles —el
// aparato reintenta solo, el chofer no tiene nada que decidir— y un cartel de fracaso convierte un
// hecho ya capturado en una duda: el chofer vuelve a la parada, o recaptura, o llama por teléfono.
// El daño no es la UI: es que la entrega se registre dos veces o que el camión se devuelva.
//
// ─── LOS TRES INVARIANTES ───────────────────────────────────────────────────────────
//
// (a) EL TRANSPORTE NO TIENE CANAL DE FRACASO. `cliente/outbox.ts` devuelve los `client_uuid`
//     ACUSADOS y nada más: un lote que no llegó devuelve `[]`. Si mañana devolviera un
//     `{ ok: false }` o tirara una excepción hacia afuera, la pantalla tendría de dónde sacar el
//     cartel — así que el canal se veta en el origen.
//
// (b) LA PANTALLA NO SE RAMIFICA POR EL FRACASO. Lo que vuelve del replay solo puede usarse para
//     SACAR de la cola lo acusado (o para un guardia positivo `> 0`). Un `if (confirmadas.length
//     === 0)` o un `if (!confirmadas.length)` es, textualmente, la rama de fracaso: ahí es donde
//     nace el cartel, y por eso es lo que el gate persigue.
//
// (c) EL POSITIVO, PARA QUE EL VERDE NO SEA VACUO. Borrar la sección «por sincronizar» entera
//     dejaría (a) y (b) en verde y sería el error opuesto: el §5.7 no pide silencio, pide el
//     contador REAL de la cola. Cada pantalla de captura tiene que seguir mostrándolo.
//
// Uso: node db/flota/gate-capturas-sin-rechazo.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 apareció un canal o una rama de fracaso, o se cayó el «por sincronizar».
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** El transporte del outbox: el único lugar del que una pantalla recibe el resultado de un replay. */
export const TRANSPORTE = "apps/flota/src/cliente/outbox.ts";

/** Dónde viven las pantallas de terreno. Las de captura se descubren por su import del transporte
 *  —y no por una lista a mano— para que una pantalla NUEVA de captura entre al gate el día que se
 *  escribe, sin que nadie se acuerde de agregarla acá. */
export const ARBOL_DE_PANTALLAS = "apps/flota/src/app";

const IGNORAR = new Set(["node_modules", "dist", "build", ".git", ".next"]);

/** Quita comentarios: explicar POR QUÉ no hay rechazo es exactamente lo que estos archivos hacen
 *  hoy, y un gate que muerde al documentar enseña a dejar de documentar. */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * (a) ¿El transporte abrió un canal de fracaso hacia afuera?
 *
 * Dos formas, las dos reales: devolver algo que no sea la lista de acusados (un booleano, un
 * `{ error }`, un `{ ok }`), o dejar salir una excepción. Devuelve las líneas ofensoras.
 */
export function canalDeFracasoEn(texto) {
  const vivo = sinComentarios(texto);
  const ofensoras = [];
  vivo.split("\n").forEach((linea, i) => {
    if (/\bthrow\b/.test(linea)) {
      ofensoras.push({
        linea: i + 1,
        motivo: "el transporte del outbox deja salir una excepción: la pantalla tendría que atajarla, y atajarla es tener una rama de fracaso",
      });
    }
    const firma = /export\s+async\s+function\s+(replayar\w*)\s*\(/.exec(linea);
    if (firma) {
      // La firma completa puede seguir en las líneas de abajo: se busca el tipo de retorno en el
      // trozo que arranca acá, que es donde la declaración termina.
      const desde = vivo.split("\n").slice(i, i + 12).join("\n");
      if (!/\)\s*:\s*Promise<string\[\]>/.test(desde)) {
        ofensoras.push({
          linea: i + 1,
          motivo: `${firma[1]} ya no devuelve Promise<string[]>: si devuelve un fracaso, la pantalla tiene de dónde sacar el cartel`,
        });
      }
    }
  });
  return ofensoras;
}

/** Los usos que SÍ son legítimos para lo que vuelve del replay: sacar de la cola lo acusado, o un
 *  guardia POSITIVO. Cualquier otra cosa es una rama que mira el fracaso. */
function usoLegitimo(linea, id) {
  // Avanzar la cola: `sacarDeLaCola(r, confirmadas)`, `new Set(confirmadas)`, `filter(...)`.
  if (/\bcola\b|Cola|filter\(|Set\(|acusad/i.test(linea)) return true;
  // Guardia positivo: «si el servidor acusó algo, sacalo». Nunca su negación.
  if (new RegExp(`${id}\\.length\\s*(>\\s*0|!==\\s*0|>=\\s*1)`).test(linea)) return true;
  return false;
}

/**
 * (b) ¿La pantalla se ramifica por el fracaso del replay?
 *
 * Encuentra el identificador al que se le asigna el `await replayar…(…)` y revisa TODOS sus usos.
 * Devuelve las líneas ofensoras con su motivo.
 */
export function ramasDeFracasoEn(texto) {
  const vivo = sinComentarios(texto);
  const lineas = vivo.split("\n");
  const ids = new Set();
  for (const linea of lineas) {
    const asignacion = /(?:const|let|var)\s+(\w+)\s*=\s*await\s+replayar\w*\s*\(/.exec(linea);
    if (asignacion) ids.add(asignacion[1]);
  }
  const ofensoras = [];
  for (const id of ids) {
    lineas.forEach((linea, i) => {
      if (!new RegExp(`\\b${id}\\b`).test(linea)) return;
      if (new RegExp(`(?:const|let|var)\\s+${id}\\s*=\\s*await\\s+replayar`).test(linea)) return;
      if (usoLegitimo(linea, id)) return;
      ofensoras.push({
        linea: i + 1,
        motivo: `«${id}» (lo que volvió del replay) se usa fuera de sacar-de-la-cola: eso es la rama de fracaso, y de ahí sale el cartel que el §5.7 prohíbe`,
      });
    });
  }
  return { ids: [...ids], ofensoras };
}

/** (c) El positivo: la pantalla de captura sigue diciendo «por sincronizar» con su contador. */
export function muestraPorSincronizar(texto) {
  return /por-sincronizar/.test(texto) && /por sincronizar/i.test(texto);
}

function archivosTsx(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (IGNORAR.has(entrada)) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

const problemas = [];

// (a) El transporte.
const transporte = join(RAIZ, TRANSPORTE);
if (!existsSync(transporte)) {
  problemas.push(`falta ${TRANSPORTE}: sin el transporte, este gate no verifica nada`);
} else {
  for (const o of canalDeFracasoEn(readFileSync(transporte, "utf8"))) {
    problemas.push(`${TRANSPORTE}:${o.linea} ${o.motivo} (§5.7, §4.2)`);
  }
}

// (b) y (c) Las pantallas que capturan, descubiertas por su import del transporte.
let pantallas = 0;
for (const ruta of archivosTsx(join(RAIZ, ARBOL_DE_PANTALLAS))) {
  const texto = readFileSync(ruta, "utf8");
  if (!/from\s+["'][^"']*cliente\/outbox\.ts["']/.test(texto)) continue;
  pantallas++;
  const rel = relative(RAIZ, ruta);
  const { ids, ofensoras } = ramasDeFracasoEn(texto);
  if (ids.length === 0) {
    problemas.push(
      `${rel} importa el transporte del outbox pero no se le encontró el replay: el gate no puede ` +
        "verificar que no se ramifique por el fracaso",
    );
  }
  for (const o of ofensoras) problemas.push(`${rel}:${o.linea} ${o.motivo}`);
  if (!muestraPorSincronizar(texto)) {
    problemas.push(
      `${rel} ya no muestra «por sincronizar» con su contador de cola: el §5.7 no pide silencio, ` +
        "pide el contador REAL — sin él, el chofer no sabe si su entrega existe",
    );
  }
}

if (pantallas === 0) {
  problemas.push(
    `ninguna pantalla de ${ARBOL_DE_PANTALLAS} importa el transporte del outbox: o se movió el ` +
      "camino de captura, o este gate quedó mirando un árbol vacío",
  );
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-capturas-sin-rechazo: ${pantallas} pantalla(s) de captura + el transporte · ${problemas.length} problemas`,
);
if (problemas.length > 0) {
  console.error("gate-capturas-sin-rechazo: ROJO");
  process.exit(1);
}
console.log("gate-capturas-sin-rechazo: VERDE");
