// El captor CONTINUO de posición mientras el turno está abierto [AC-FTEL-01, AC-FTEL-03] — §7.8,
// §11, §4.6.
//
// `watchPosition`, y no `getCurrentPosition` como `cliente/gps.ts` (una lectura PUNTUAL al
// cerrar una parada del POD): acá el punto ES el seguimiento continuo mientras dura la jornada,
// así que vive detrás de la puerta de privacidad del §7.8 — nace SOLO con el turno abierto y
// `detenerRastreo()` lo apaga siempre, sin que ningún ajuste del tenant pueda evitarlo.
//
// EL TRANSPORTE ES EL MISMO OUTBOX QUE EL POD Y LA RECARGA [AC-FTEL-03] — §4.6: este archivo NO
// sabe de `localStorage` ni de `/api/sync/capturas`, solo capta. Cada fix se entrega a
// `alCapturar`, y es quien llama (`app/turno/estado-de-rastreo.tsx`) el que arma el
// `client_uuid`/doble reloj y lo encola — mismo reparto de responsabilidades que
// `dominio/recarga-terreno.ts` (la captura pura) frente a `cliente/outbox-local.ts` (el disco).
// LA BASE SIGUE SIENDO LA AUTORIDAD: si el turno cerró entre la captura y el replay, el punto
// rebota en la base (0074) y `servidor/posiciones-sync.ts` lo descarta sin tumbar el lote.

export type ObservadorDeGps = {
  watchPosition(
    exito: (posicion: { coords: { latitude: number; longitude: number; accuracy: number | null } }) => void,
    error: (err: { code: number }) => void,
  ): number;
  clearWatch(id: number): void;
};

function gpsDelNavegador(): ObservadorDeGps | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return navigator.geolocation;
}

/** Un fix del GPS, tal como este captor lo entrega — sin `client_uuid` ni reloj: eso lo pone
 *  quien encola (§4.6), no el transporte. */
export type PosicionCruda = { lat: number; lng: number; precisionM: number | null };

/**
 * Arranca el rastreo de UN turno abierto. Devuelve la función que lo apaga — hay que llamarla
 * SIEMPRE al cerrar el turno o al salir de la pantalla, porque ahí termina la autorización de
 * capturar (§7.8). Sin soporte de geolocalización, degrada a no-op: jamás lanza y jamás bloquea
 * el resto de la pantalla (mismo principio que `capturarGps`, §7.6).
 */
export function iniciarRastreo(
  alCapturar: (posicion: PosicionCruda) => void,
  observador: ObservadorDeGps | null = gpsDelNavegador(),
): () => void {
  if (observador === null) return () => {};
  const id = observador.watchPosition(
    (posicion) => {
      alCapturar({
        lat: posicion.coords.latitude,
        lng: posicion.coords.longitude,
        precisionM: Number.isFinite(posicion.coords.accuracy) ? posicion.coords.accuracy : null,
      });
    },
    () => {
      // Sin permiso o sin fix. El §7.6 reserva el aviso al operario para la captura del POD;
      // esta es una captura de fondo que jamás interrumpe nada del terreno.
    },
  );
  return () => observador.clearWatch(id);
}
