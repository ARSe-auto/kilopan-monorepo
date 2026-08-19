// El undo de 8 s con semántica CERRADA, y el outbox durable que la sostiene [AC-FPOD-08] —
// §4.7 (outbox y undo), §0 (`UNDO.ventana_ms`, `UNDO.estado_local`, `UNDO.motivo_supersede`),
// §10 (% PODs supersedidos), §7.4 (append-only), §5.7.
//
// ─── «INMEDIATO» ES LA PALABRA QUE HACE EL TRABAJO ────────────────────────────────
//
// El §4.7 no dice que la captura se guarde cuando venza la ventana: dice que se escribe
// INMEDIATAMENTE al outbox con estado `pending_undo`. La diferencia es un teléfono que se apaga
// —batería, un cierre del sistema, el chofer que mata la app— a los tres segundos del toque. Si
// la ventana fuera una espera en memoria, esa entrega no existiría en ninguna parte: ni en el
// aparato ni en el servidor, y el chofer creería haberla cerrado. Por eso el outbox se escribe
// en el mismo gesto y `alArrancar` decide qué hacer con lo que quedó a medias.
//
// ─── LAS TRES RAMAS, Y NINGUNA CUARTA ─────────────────────────────────────────────
//
//   (a) undo DENTRO de la ventana: la mutación se cancela ANTES del replay y jamás sale del
//       dispositivo. No deja rastro porque no hay hecho que contar — el chofer se equivocó de
//       botón y lo arregló antes de caminar.
//   (b) la app MUERE dentro de la ventana: al reabrir, la captura está y se replayea. La ventana
//       no sobrevive al cierre a propósito — nadie puede deshacer algo que dejó de mirar hace
//       una hora, y el §4.7 pone el límite del arrepentimiento en ocho segundos, no en la vida
//       del proceso.
//   (c) undo DESPUÉS del replay: el hecho ya está en el orden autoritativo del tenant (§4.6) y
//       borrarlo sería reescribir el pasado (§7.4). La corrección es una fila NUEVA que la
//       supersede con motivo `undo` — dos filas, la original intacta— y ese motivo la deja
//       EXCLUIDA del métrico de gaming del §10 por la definición SQL de
//       `pods_supersedidos_semanal` (migración 0053), jamás por un filtro repetido en cada panel.
//
// La rama (c) no es teórica ni sirve solo al operador: el toque de «Deshacer» a los 7,9 s y el
// temporizador de la ventana compiten de verdad, y sin ella ese toque se perdía en silencio —la
// captura ya estaba en la cola y salía igual, con el chofer creyendo que la había deshecho.
//
// El outbox VIVE en `Recorrido` y no en una segunda estructura paralela: la captura dentro de la
// ventana (`captura`) más las que esperan replay (`cola`) son el outbox entero, y proyectarlo es
// una función pura. Dos listas con la misma verdad se desalinean el día que alguien toque una.

import {
  deshacer,
  type CapturaDeEntrega,
  type Recorrido,
  type SelloDelAparato,
} from "./pod-terreno.ts";
import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";

/** El outbox tal como se GUARDA: primero lo que espera replay, al final lo que sigue dentro de
 *  su ventana. El orden es el de captura, que es el que el replay respeta. */
export function outboxDeRecorrido(r: Recorrido): CapturaDeEntrega[] {
  return r.captura === null ? [...r.cola] : [...r.cola, r.captura];
}

/**
 * Lo que el outbox durable trae al abrir la app (rama (b)).
 *
 * Todo lo que quedó en `pending_undo` pasa a `por_replicar`: la ventana era del gesto, no del
 * archivo. Devolverlo en `pending_undo` sería reabrirle al chofer un arrepentimiento de una
 * jornada anterior; descartarlo sería perder la entrega que el §4.2 declara un hecho del mundo.
 */
export function colaAlArrancar(guardado: readonly CapturaDeEntrega[]): CapturaDeEntrega[] {
  return guardado.map((c) => (c.estado === UNDO.estado_local ? { ...c, estado: "por_replicar" as const } : c));
}

/** Qué pasó con el toque de «Deshacer». `nada` es el caso honesto de que no había qué deshacer
 *  —la cola vacía, o la captura ya corregida— y no un fracaso que mostrarle a nadie (§5.7). */
export type ResultadoDeUndo =
  | { tipo: "cancelada"; recorrido: Recorrido }
  | { tipo: "supersedida"; recorrido: Recorrido; supersede: CapturaDeEntrega }
  | { tipo: "nada"; recorrido: Recorrido };

/**
 * El undo, con la rama que corresponde al estado REAL de la captura y no al de la pantalla.
 *
 * Dentro de la ventana delega en `deshacer` (que además devuelve al chofer a la parada donde se
 * equivocó). Vencida, arma el supersede: una captura nueva, con su propio `client_uuid` —es un
 * hecho distinto y necesita su propia llave de idempotencia (§0)—, apuntando a la original por
 * `supersedeDe` y con `motivoSupersede` = `undo`.
 *
 * La supersedida es la ÚLTIMA de la cola que todavía no fue corregida: es la que acababa de
 * cerrar su ventana cuando el dedo llegó tarde. Una captura que ya tiene su supersede no se
 * vuelve a deshacer — dos correcciones del mismo hecho serían dos filas contra una, y el métrico
 * del §10 contaría dos veces lo que pasó una.
 */
export function deshacerCaptura(r: Recorrido, sello: SelloDelAparato): ResultadoDeUndo {
  if (r.captura !== null) return { tipo: "cancelada", recorrido: deshacer(r) };

  const original = ultimaCorregible(r.cola);
  if (original === null) return { tipo: "nada", recorrido: r };

  const supersede: CapturaDeEntrega = {
    ...original,
    clientUuid: sello.clientUuid,
    tsDispositivo: sello.tsDispositivo,
    tzOffsetMin: sello.tzOffsetMin,
    // El supersede es un hecho NUEVO del dispositivo [AC-FPOD-10] — §4.7: hereda la secuencia de
    // `original` sería repetir un número ya usado, y el hueco que eso finge no existe. El toque
    // de «Deshacer» consume su propio lugar en la secuencia, igual que consume su propio
    // `client_uuid` (§0).
    secuenciaDispositivo: sello.secuenciaDispositivo,
    estado: "por_replicar",
    supersedeDe: original.clientUuid,
    motivoSupersede: UNDO.motivo_supersede,
  };
  return { tipo: "supersedida", recorrido: { ...r, cola: [...r.cola, supersede] }, supersede };
}

/** La última captura de terreno de la cola que nadie supersedió todavía. */
function ultimaCorregible(cola: readonly CapturaDeEntrega[]): CapturaDeEntrega | null {
  const corregidas = new Set(cola.map((c) => c.supersedeDe).filter((id): id is string => id !== null));
  for (let i = cola.length - 1; i >= 0; i--) {
    const candidata = cola[i]!;
    if (candidata.supersedeDe === null && !corregidas.has(candidata.clientUuid)) return candidata;
  }
  return null;
}
