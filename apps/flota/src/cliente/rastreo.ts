import { pedir } from "./aparato.ts";

// El captor CONTINUO de posición mientras el turno está abierto [AC-FTEL-01] — §7.8, §11.
//
// `watchPosition`, y no `getCurrentPosition` como `cliente/gps.ts` (una lectura PUNTUAL al
// cerrar una parada del POD): acá el punto ES el seguimiento continuo mientras dura la jornada,
// así que vive detrás de la puerta de privacidad del §7.8 — nace SOLO con el turno abierto y
// `detenerRastreo()` lo apaga siempre, sin que ningún ajuste del tenant pueda evitarlo.
//
// LA BASE ES LA AUTORIDAD, ESTO ES SOLO EL TRANSPORTE. Si `iniciarRastreo` se llamara con un
// turno que ya cerró —una carrera entre el cierre y un fix en vuelo—, el POST de esa posición
// rebota en la base (0074) y se descarta en silencio (§4.2: una posición perdida no bloquea
// nada del terreno). El lote con reintento offline es AC-FTEL-03 y no se adelanta acá.

export type ObservadorDeGps = {
  watchPosition(
    exito: (posicion: { coords: { latitude: number; longitude: number } }) => void,
    error: (err: { code: number }) => void,
  ): number;
  clearWatch(id: number): void;
};

function gpsDelNavegador(): ObservadorDeGps | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return navigator.geolocation;
}

/**
 * Arranca el rastreo de UN turno abierto. Devuelve la función que lo apaga — hay que llamarla
 * SIEMPRE al cerrar el turno o al salir de la pantalla, porque ahí termina la autorización de
 * capturar (§7.8). Sin soporte de geolocalización, degrada a no-op: jamás lanza y jamás bloquea
 * el resto de la pantalla (mismo principio que `capturarGps`, §7.6).
 */
export function iniciarRastreo(
  turnoId: string,
  observador: ObservadorDeGps | null = gpsDelNavegador(),
): () => void {
  if (observador === null) return () => {};
  const id = observador.watchPosition(
    (posicion) => {
      void pedir(`/api/turnos/${turnoId}/posiciones`, {
        method: "POST",
        body: JSON.stringify({ lat: posicion.coords.latitude, lng: posicion.coords.longitude }),
      }).catch(() => {
        // Degrada en silencio (§4.2): una posición perdida no bloquea nada del terreno.
      });
    },
    () => {
      // Sin permiso o sin fix. El §7.6 reserva el aviso al operario para la captura del POD;
      // esta es una captura de fondo que jamás interrumpe nada del terreno.
    },
  );
  return () => observador.clearWatch(id);
}
