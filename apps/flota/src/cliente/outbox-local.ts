import type { CapturaDeEntrega } from "../dominio/pod-terreno.ts";
import type { CapturaDeRecarga } from "../dominio/recarga-terreno.ts";

// El outbox DURABLE del aparato [AC-FPOD-08], particionado por (tenant, usuario) [AC-FPOD-09] —
// §4.7.
//
// ─── POR QUÉ ESTO EXISTE COMO ARCHIVO APARTE ──────────────────────────────────────
//
// La semántica del undo es pura y vive en `dominio/outbox-undo.ts`; acá está lo único que no
// puede serlo: escribir en el aparato. Separarlos es lo que permite probar las tres ramas del
// §4.7 sin navegador y, al mismo tiempo, que el guardado se ejerza de verdad en el e2e con un
// cierre de app real.
//
// ─── LA PARTICIÓN ES LA LLAVE, NO UN CAMPO DENTRO DEL VALOR [AC-FPOD-09] ──────────
//
// El §4.7 es literal: «autenticarse otra identidad en el mismo dispositivo purga SOLO el
// snapshot». Antes de este AC la llave era UNA constante compartida por todo el aparato: si un
// segundo operario se autenticaba en el mismo teléfono —el `dispositivo tipo anden` compartido,
// o un teléfono personal que cambia de dueño sin que alguien lo borre— su outbox pisaba el mismo
// `localStorage.setItem`, y las capturas de A que todavía esperaban replay se leían de vuelta
// como si fueran de B (o directamente se perdían bajo el `setItem` del primer guardado de B).
// Particionar por `(tenant, usuario)` en la LLAVE —no en un campo `tenant`/`usuario` dentro del
// array guardado— es lo que hace que dos identidades JAMÁS puedan pisarse: son dos entradas de
// `localStorage` distintas, y nada que este módulo escriba borra la otra. «Jamás purgado» no es
// una promesa de código que decide no borrar: es la ausencia de cualquier código que tenga la
// llave ajena para borrar. Quién replayea lo que quedó bajo la llave de una identidad que ya no
// es la activa es responsabilidad de `cliente/outbox-multiusuario.ts`, no de este archivo.
//
// ─── QUÉ NO RESUELVE ESTE AC ──────────────────────────────────────────────────────
//
// Los huecos de la secuencia monotónica y la evicción de IndexedDB son AC-FPOD-10. El almacén
// entra como parámetro —no se toca `window` desde el módulo— para que el test lo ejerza sin
// navegador.
//
// ─── UN DATO ILEGIBLE NO ES UNA ENTREGA ───────────────────────────────────────────
//
// Lo guardado puede volver roto: otra versión de la app, un almacén que alguien editó, media
// escritura. `leerOutbox` devuelve lista vacía antes que capturas a medio armar — una captura sin
// `client_uuid` no tiene llave de idempotencia (§0) y replayarla sería escribir el mismo hecho
// tantas veces como reintentos haya.

/** Lo mínimo del `Storage` del navegador que este outbox usa. Tipar solo eso deja que el test lo
 *  reemplace con un objeto de tres líneas. */
export type AlmacenLocal = {
  getItem(llave: string): string | null;
  setItem(llave: string, valor: string): void;
};

/** Quién es «usuario» en la partición del §4.7 [AC-FPOD-09]. `tenant` es el origen del aparato
 *  (cada tenant vive en su propio subdominio, así que ya viene aislado por el navegador; se
 *  repite en la llave a propósito, para no depender solo de esa garantía implícita). `usuario`
 *  es un identificador estable de la credencial activa —ver `cliente/identidad.ts`, que lo
 *  deriva del secreto de sesión sin tocar la red—, NUNCA la credencial en claro: esta llave vive
 *  en `localStorage`, que lee cualquier script de la página (mismo criterio que `cliente/
 *  aparato.ts` para no poner el secreto ahí). */
export type Identidad = { tenant: string; usuario: string };

/** La llave del outbox del POD para UNA identidad. Dos identidades ⇒ dos llaves distintas ⇒
 *  ningún `setItem` de una puede pisar el `getItem` de la otra [AC-FPOD-09]. */
export function llaveOutboxPod(identidad: Identidad): string {
  return `flota.outbox.pod.${identidad.tenant}.${identidad.usuario}`;
}

/** El índice de qué identidades tienen (o tuvieron) outbox en este aparato [AC-FPOD-09]. Sin
 *  esto, replayar «lo de la identidad anterior» exigiría enumerar `localStorage` entero —que
 *  `AlmacenLocal` no ofrece a propósito, para que el test siga siendo un objeto de tres líneas—
 *  o, peor, exigiría que alguien SIGA SABIENDO cuál era la identidad anterior después de que
 *  otra la reemplazó. El índice es la única memoria de «quién más escribió acá». */
const LLAVE_INDICE_IDENTIDADES = "flota.outbox.identidades";

function esIdentidad(x: unknown): x is Identidad {
  if (typeof x !== "object" || x === null) return false;
  const i = x as Partial<Identidad>;
  return typeof i.tenant === "string" && typeof i.usuario === "string";
}

/** Todas las identidades que alguna vez guardaron outbox en este aparato, más antigua primero. */
export function listarIdentidadesConOutbox(almacen: AlmacenLocal): Identidad[] {
  let crudo: string | null;
  try {
    crudo = almacen.getItem(LLAVE_INDICE_IDENTIDADES);
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
  return Array.isArray(leido) ? leido.filter(esIdentidad) : [];
}

function registrarIdentidad(almacen: AlmacenLocal, identidad: Identidad): void {
  const previas = listarIdentidadesConOutbox(almacen);
  if (previas.some((i) => i.tenant === identidad.tenant && i.usuario === identidad.usuario)) return;
  try {
    almacen.setItem(LLAVE_INDICE_IDENTIDADES, JSON.stringify([...previas, identidad]));
  } catch {
    /* mismo criterio que `guardarOutbox`: un almacén lleno o negado no rebota. */
  }
}

function esCaptura(x: unknown): x is CapturaDeEntrega {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Partial<CapturaDeEntrega>;
  return (
    typeof c.clientUuid === "string" &&
    typeof c.paradaId === "string" &&
    typeof c.tsDispositivo === "string" &&
    typeof c.tzOffsetMin === "number" &&
    typeof c.resultado === "string" &&
    Number.isInteger(c.secuenciaDispositivo) &&
    (c.estado === "pending_undo" || c.estado === "por_replicar") &&
    (c.supersedeDe === null || typeof c.supersedeDe === "string") &&
    (c.motivoSupersede === null || typeof c.motivoSupersede === "string")
  );
}

export function leerOutbox(almacen: AlmacenLocal, identidad: Identidad): CapturaDeEntrega[] {
  let crudo: string | null;
  try {
    crudo = almacen.getItem(llaveOutboxPod(identidad));
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

/** Escribe el outbox entero DE ESTA IDENTIDAD [AC-FPOD-09]. Se llama en el MISMO gesto que
 *  cierra la parada: el §4.7 dice «inmediatamente», y un guardado diferido es exactamente el
 *  hueco que la app que muere a los 3 s aprovecha. Un almacén lleno o negado no puede tumbar la
 *  entrega en curso —el hecho ya ocurrió (§4.2)—, así que la excepción se traga y la captura
 *  sigue viva en memoria. Escribir bajo la llave particionada es lo que garantiza que este
 *  `setItem` jamás toca el outbox de otra identidad que se haya autenticado antes en el mismo
 *  aparato. */
export function guardarOutbox(
  almacen: AlmacenLocal,
  identidad: Identidad,
  outbox: readonly CapturaDeEntrega[],
): void {
  registrarIdentidad(almacen, identidad);
  try {
    almacen.setItem(llaveOutboxPod(identidad), JSON.stringify(outbox));
  } catch {
    /* `persist()` denegado o cuota llena: es telemetría de AC-FPOD-14, jamás un rebote acá. */
  }
}

// ─── EL OUTBOX GENERALIZADO A LA RECARGA [AC-FPOD-13] — §4.7, §4.2, §4.8 ──────────
//
// «El cierre de recarga viaja por el MISMO outbox» es literal: misma partición por
// (tenant, usuario), mismo índice de identidades (`registrarIdentidad`/`listarIdentidadesCon
// Outbox`, arriba), la misma disciplina de «un almacén lleno o negado no tumba la captura en
// curso». Lo único nuevo es la LLAVE —una partición propia dentro del mismo esquema, para que
// una captura de recarga jamás se lea como si fuera una de POD, ni al revés— y el tipo que
// guarda.

/** La llave del outbox de RECARGA para una identidad — el mismo esquema que `llaveOutboxPod`
 *  (§4.7), en su propia partición [AC-FPOD-13]. */
export function llaveOutboxRecarga(identidad: Identidad): string {
  return `flota.outbox.recarga.${identidad.tenant}.${identidad.usuario}`;
}

function esCapturaDeRecarga(x: unknown): x is CapturaDeRecarga {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Partial<CapturaDeRecarga>;
  return (
    typeof c.clientUuid === "string" &&
    typeof c.vehiculoId === "string" &&
    (c.turnoId === null || typeof c.turnoId === "string") &&
    Number.isInteger(c.wh) &&
    (c.socFinal === null || typeof c.socFinal === "number") &&
    typeof c.tsDispositivo === "string" &&
    typeof c.tzOffsetMin === "number" &&
    c.estado === "por_replicar"
  );
}

/** Lo mismo que `leerOutbox`, para la cola de recarga: un dato ilegible vuelve lista vacía antes
 *  que una captura a medio armar, porque sin `clientUuid` no hay llave de idempotencia (§0)
 *  [AC-FPOD-13]. */
export function leerOutboxRecarga(almacen: AlmacenLocal, identidad: Identidad): CapturaDeRecarga[] {
  let crudo: string | null;
  try {
    crudo = almacen.getItem(llaveOutboxRecarga(identidad));
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
  return Array.isArray(leido) ? leido.filter(esCapturaDeRecarga) : [];
}

/** Lo mismo que `guardarOutbox`, para la cola de recarga [AC-FPOD-13]. */
export function guardarOutboxRecarga(
  almacen: AlmacenLocal,
  identidad: Identidad,
  outbox: readonly CapturaDeRecarga[],
): void {
  registrarIdentidad(almacen, identidad);
  try {
    almacen.setItem(llaveOutboxRecarga(identidad), JSON.stringify(outbox));
  } catch {
    /* mismo criterio que `guardarOutbox`: persist() denegado o cuota llena no rebota. */
  }
}
