import type { CapturaDeEntrega } from "../dominio/pod-terreno.ts";

// El outbox DURABLE del aparato [AC-FPOD-08] — §4.7.
//
// ─── POR QUÉ ESTO EXISTE COMO ARCHIVO APARTE ──────────────────────────────────────
//
// La semántica del undo es pura y vive en `dominio/outbox-undo.ts`; acá está lo único que no
// puede serlo: escribir en el aparato. Separarlos es lo que permite probar las tres ramas del
// §4.7 sin navegador y, al mismo tiempo, que el guardado se ejerza de verdad en el e2e con un
// cierre de app real.
//
// ─── QUÉ NO RESUELVE ESTE AC ──────────────────────────────────────────────────────
//
// La partición por (tenant, usuario) y la prohibición de purgar son AC-FPOD-09; los huecos de la
// secuencia monotónica y la evicción de IndexedDB, AC-FPOD-10. Acá el contrato es más chico y
// entero: lo escrito ANTES de que la ventana venza sigue estando después de cerrar la app. El
// almacén entra como parámetro —no se toca `window` desde el módulo— para que el AC que agregue
// la partición cambie el almacén y no la semántica.
//
// ─── UN DATO ILEGIBLE NO ES UNA ENTREGA ───────────────────────────────────────────
//
// Lo guardado puede volver roto: otra versión de la app, un almacén que alguien editó, media
// escritura. `leerOutbox` devuelve lista vacía antes que capturas a medio armar — una captura sin
// `client_uuid` no tiene llave de idempotencia (§0) y replayarla sería escribir el mismo hecho
// tantas veces como reintentos haya.

/** Lo mínimo del `Storage` del navegador que este outbox usa. Tipar solo eso deja que el test lo
 *  reemplace con un objeto de tres líneas y que el AC-FPOD-09 lo cambie por IndexedDB. */
export type AlmacenLocal = {
  getItem(llave: string): string | null;
  setItem(llave: string, valor: string): void;
};

/** La llave del outbox del POD. El sufijo por (tenant, usuario) es AC-FPOD-09. */
export const LLAVE_OUTBOX_POD = "flota.outbox.pod";

function esCaptura(x: unknown): x is CapturaDeEntrega {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Partial<CapturaDeEntrega>;
  return (
    typeof c.clientUuid === "string" &&
    typeof c.paradaId === "string" &&
    typeof c.tsDispositivo === "string" &&
    typeof c.tzOffsetMin === "number" &&
    typeof c.resultado === "string" &&
    (c.estado === "pending_undo" || c.estado === "por_replicar") &&
    (c.supersedeDe === null || typeof c.supersedeDe === "string") &&
    (c.motivoSupersede === null || typeof c.motivoSupersede === "string")
  );
}

export function leerOutbox(almacen: AlmacenLocal): CapturaDeEntrega[] {
  let crudo: string | null;
  try {
    crudo = almacen.getItem(LLAVE_OUTBOX_POD);
  } catch {
    return [];
  }
  if (crudo === null) return [];
  let leido: unknown;
  try {
    leido = JSON.parse(crudo);
  } catch {
    return [];
  }
  return Array.isArray(leido) ? leido.filter(esCaptura) : [];
}

/** Escribe el outbox entero. Se llama en el MISMO gesto que cierra la parada: el §4.7 dice
 *  «inmediatamente», y un guardado diferido es exactamente el hueco que la app que muere a los
 *  3 s aprovecha. Un almacén lleno o negado no puede tumbar la entrega en curso —el hecho ya
 *  ocurrió (§4.2)—, así que la excepción se traga y la captura sigue viva en memoria. */
export function guardarOutbox(almacen: AlmacenLocal, outbox: readonly CapturaDeEntrega[]): void {
  try {
    almacen.setItem(LLAVE_OUTBOX_POD, JSON.stringify(outbox));
  } catch {
    /* `persist()` denegado o cuota llena: es telemetría de AC-FPOD-14, jamás un rebote acá. */
  }
}
