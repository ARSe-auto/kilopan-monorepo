import { resolverGps, type MotivoSinGps, type ResultadoDeGps } from "../dominio/captura-progresiva.ts";

// Una lectura PUNTUAL de GPS al llegar a la parada [AC-FPOD-12] — §3.E1.15, §7.6.
//
// Puntual y no `watchPosition`: la minimización del 21.719 (§3.E1.15 «GPS off por defecto») es
// sobre el SEGUIMIENTO continuo, no sobre una lectura suelta al momento del cierre. Este
// archivo pide esa única lectura; `resolverGps` (dominio/captura-progresiva.ts) traduce el
// resultado o el error al flag que la pantalla necesita.
export type CaptorDeGps = {
  getCurrentPosition(exito: () => void, error: (err: { code: number }) => void): void;
};

function gpsDelNavegador(): CaptorDeGps | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return navigator.geolocation;
}

/** El código `PERMISSION_DENIED` del estándar `GeolocationPositionError` (siempre 1, en todo
 *  navegador): es el ÚNICO caso que dispara el aviso al operario (§7.6) — `POSITION_UNAVAILABLE`
 *  y `TIMEOUT` son la mala precisión de la que el maestro dice «jamás bloquea», y tampoco es
 *  una decisión del operario que avisarle le sirva de algo. */
const PERMISO_DENEGADO = 1;

function motivoDelError(error: { code: number }): MotivoSinGps {
  return error.code === PERMISO_DENEGADO ? "permiso_denegado" : "no_disponible";
}

/**
 * Pide UNA lectura de posición. Sin soporte, sin permiso o sin fix ⇒ degrada a «sin
 * coordenadas» con el motivo que corresponde — JAMÁS lanza y jamás bloquea el cierre de la
 * parada ni su sync (§7.6, §4.2) [AC-FPOD-12].
 */
export function capturarGps(captor: CaptorDeGps | null = gpsDelNavegador()): Promise<ResultadoDeGps> {
  return new Promise((resolve) => {
    if (captor === null) {
      resolve(resolverGps("no_disponible"));
      return;
    }
    captor.getCurrentPosition(
      () => resolve(resolverGps(null)),
      (error) => resolve(resolverGps(motivoDelError(error))),
    );
  });
}
