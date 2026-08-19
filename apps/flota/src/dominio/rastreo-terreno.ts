// La posición en vivo, capturada por el MISMO outbox que el POD y la recarga [AC-FTEL-03] —
// §4.2, §4.6, §4.7.
//
// Mismo patrón que `recarga-terreno.ts`: el tipo que el outbox guarda y replayea, en su propia
// partición para que un punto de posición jamás se lea como si fuera una captura de otra clase.
// Sin `estado`: a diferencia del POD (`pending_undo`/`por_replicar`) la posición no tiene ventana
// de deshacer — el chofer no toca nada, el punto nace directamente listo para el outbox.

/** Una posición del teléfono, tal como el outbox la guarda y replayea (§0, §4.6). `precisionM`
 *  viaja tal cual la reportó el GPS —sin techo, §4—: una precisión mala nunca bloquea. */
export type CapturaDePosicion = {
  clientUuid: string;
  turnoId: string;
  lat: number;
  lng: number;
  precisionM: number | null;
  tsDispositivo: string;
  tzOffsetMin: number;
};
