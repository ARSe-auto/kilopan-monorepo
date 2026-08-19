// El texto del estado de rastreo que el chofer VE [AC-FTEL-01] — §7.8, §11.
//
// El §7.8 (Ley 21.719) pide que el rastreado SIEMPRE pueda ver que está siendo rastreado, y que
// ese aviso no sea configurable ni removible por el tenant. Esta función es pura a propósito:
// el componente de pantalla la usa para decidir QUÉ dice, y un pgTAP o un test de node:test la
// puede ejercer sin un navegador — ninguna decisión del §7.8 queda escondida dentro de un efecto
// de React que solo un e2e pudiera ver.

export type EstadoDeRastreo =
  | { rastreando: true; texto: string }
  | { rastreando: false; texto: "Rastreo apagado" };

/**
 * `abiertoEn` es el `abierto_en` del turno, ISO. `null` ⇒ sin turno abierto ⇒ el rastreo está
 * apagado — el ÚNICO motivo por el que este texto cambia (§7.8): nunca una preferencia, nunca
 * un ajuste del tenant.
 */
export function estadoDeRastreo(abiertoEn: string | null): EstadoDeRastreo {
  if (abiertoEn === null) return { rastreando: false, texto: "Rastreo apagado" };
  // `hour12: false`: el AC pide literal «rastreado desde HH:MM» — 24 horas, no «10:05 a. m.»
  // que es-CL devuelve por defecto.
  const hora = new Date(abiertoEn).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { rastreando: true, texto: `En ruta, rastreado desde ${hora}` };
}
