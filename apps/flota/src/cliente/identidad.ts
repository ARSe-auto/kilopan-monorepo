import { leerSecreto, leerIdentidadAnden } from "./aparato.ts";
import type { Identidad } from "./outbox-local.ts";

export type { Identidad } from "./outbox-local.ts";

// Quién es «usuario» en la partición del outbox (§4.7) [AC-FPOD-09] — derivado del secreto de
// sesión que YA está en IndexedDB (`cliente/aparato.ts`), SIN red.
//
// ─── POR QUÉ ESTO NO PEGA A `/api/sesion` ─────────────────────────────────────────
//
// La partición tiene que existir en el mismo gesto en que se guarda una captura offline, y ese
// gesto puede ocurrir en un galpón sin señal. Pedirle la identidad al servidor convertiría el
// primer guardado del outbox en un guardado que depende de la red — exactamente lo que el §3.E1.7
// prohíbe. El secreto del aparato ya es la credencial que distingue a un operario de otro (§4.3:
// «la sesión ES el aparato»), así que hashearlo ACÁ, sin ida y vuelta, resuelve la partición con
// lo que el navegador ya tiene en el disco.
//
// ─── POR QUÉ SE HASHEA Y NO SE USA EL SECRETO CRUDO COMO LLAVE ────────────────────
//
// La llave resultante vive en `localStorage`, que lee cualquier script de la página — el mismo
// motivo por el que `aparato.ts` guarda el secreto en IndexedDB y no ahí. El hash sirve para
// distinguir identidades, no para autenticar nada: nunca viaja a ningún lado y nunca hace falta
// invertirlo.
//
// ─── POR QUÉ ESTO CAMBIA SOLO CON UN ENROLAMIENTO NUEVO, Y NUNCA ANTES ────────────
//
// `guardarSecreto` (aparato.ts) se llama exactamente una vez por enrolamiento u otorgamiento de
// sesión, y cada uno trae un secreto NUEVO del servidor (AC-FIDN-04, AC-FIDN-17, AC-FIDN-20).
// Autenticarse otra identidad en el mismo dispositivo es, en los términos de este archivo,
// exactamente eso: un `guardarSecreto` nuevo que sobrescribe el único registro que `aparato.ts`
// mantiene. La partición sigue la credencial, no una sesión de navegador ni un estado propio.

/** El origen del aparato: cada tenant vive en su propio subdominio (§4.1), así que ya es un
 *  aislamiento REAL del navegador — se repite en la partición para no depender solo de eso. */
function tenantDelOrigen(): string {
  return location.hostname;
}

async function huellaDeSecreto(secreto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secreto));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** La identidad activa de ESTE aparato, o `null` cuando todavía no guardó ningún secreto (no
 *  enrolado, o esperando aprobación). Determinística y offline: el mismo secreto siempre hashea
 *  a la misma partición, y un secreto distinto —la marca de que «otra identidad se autenticó en
 *  el mismo dispositivo» del §4.7— siempre hashea a otra. */
export async function identidadDelAparato(): Promise<Identidad | null> {
  // EL ANDÉN MANDA CUANDO ESTÁ [AC-FIDN-07] — §5.4 F-D, §4.7. Su secreto es del APARATO y no se
  // mueve cuando los operarios rotan por PIN, así que hashearlo daría UNA sola partición para
  // todos los que pasen por esa mesa: las tres capturas de A y la de B bajo la misma llave, y al
  // sincronizar todas a nombre de quien esté autenticado. La huella que el servidor emite al
  // rotar es por PAREJA (aparato, operario), y es lo que hace que rotar purgue el snapshot y NADA
  // más. Se lee sin red, igual que la otra: la partición tiene que existir en el mismo gesto en
  // que se guarda una captura en un galpón sin señal.
  const anden = await leerIdentidadAnden();
  if (anden !== null) return { tenant: tenantDelOrigen(), usuario: anden };

  const secreto = await leerSecreto();
  if (secreto === null) return null;
  return { tenant: tenantDelOrigen(), usuario: await huellaDeSecreto(secreto) };
}
