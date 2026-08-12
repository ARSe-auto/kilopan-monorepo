"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SEMAFORO } from "../../../../../packages/nucleo-comun/src/constants.ts";
import type { TarjetaHoy } from "../../dominio/semaforo.ts";
import { pedir } from "../../cliente/aparato.ts";

// Refresco del digest [AC-FSEM-06] — spec 05 §2.6, §4.
//
// Polling HTTP puro con ETag/304, SOLO con la pestaña visible (Page Visibility API) — pestaña
// oculta detiene el temporizador entero, cero requests hasta que vuelva a estar visible. Nada
// de WebSockets ni SSE en v1 (§5.6-refresco; el grep del módulo lo verifica en el e2e). El
// intervalo sale de `SEMAFORO.polling_segundos` (constants.ts) — el piso del rango (15 s) sigue
// siendo un punto válido de «cada 15–30 s» y es el más exigente de probar; el número no está
// escrito acá, sale de la constante.
const INTERVALO_MS = SEMAFORO.polling_segundos.min * 1000;

/** `Response.json` serializa `record_time` como texto ISO — `fechaEsCl`/`horaEsCl` (§0) exigen
 *  un `Date` real, así que hay que revivirlo apenas cruza el borde de red o la tarjeta rojo/
 *  amarillo revienta al re-renderizar con el digest recién llegado. */
function revivirFechas(tarjeta: TarjetaHoy): TarjetaHoy {
  if (!tarjeta.excepcionMasAntigua) return tarjeta;
  return {
    ...tarjeta,
    excepcionMasAntigua: { ...tarjeta.excepcionMasAntigua, record_time: new Date(tarjeta.excepcionMasAntigua.record_time) },
  };
}

export type EstadoRefrescoDigest = {
  tarjetas: TarjetaHoy[];
  /** false = el último intento de refresco no llegó al servidor (sin conexión real). */
  conectado: boolean;
  /** Intentos fallidos consecutivos desde el último digest recibido con éxito — la «cola» real
   *  del §5.7 para esta pantalla: «Hoy» no encola capturas de terreno (eso es del outbox del
   *  chofer), así que lo único que hay de verdad para contar es cuántas veces el refresco no
   *  pudo llegar. */
  intentosFallidos: number;
  /** epoch ms del último digest recibido con éxito (200 con body nuevo, o 304 confirmando que
   *  el que ya había seguía vigente) — la antigüedad que se le marca al usuario en offline. */
  ultimoDigestEn: number;
  /** Estado «skeleton <50 ms» del §5.7 [AC-FSEM-12] — SOLO durante un refresco MANUAL (el poll
   *  de fondo jamás lo enciende: no hay «cargando» que anunciar por un refresco silencioso). */
  cargando: boolean;
  /** Estado «error es-CL con recuperación» del §5.7 [AC-FSEM-12], DISTINTO de «sin conexión»: el
   *  servidor respondió y respondió mal (`!r.ok`, no una falla de red) — solo se enciende cuando
   *  quien pidió el refresco fue una persona tocando «Actualizar», así el poll de fondo silencioso
   *  jamás le muestra un error transitorio a nadie que no lo pidió. `null` = sin error vigente. */
  errorManual: string | null;
};

export function useDigestSemaforo(seed: "a" | "c", tarjetasIniciales: TarjetaHoy[]) {
  const etagRef = useRef<string | null>(null);
  const [estado, setEstado] = useState<EstadoRefrescoDigest>({
    tarjetas: tarjetasIniciales,
    conectado: true,
    intentosFallidos: 0,
    ultimoDigestEn: Date.now(),
    cargando: false,
    errorManual: null,
  });

  const refrescar = useCallback(
    async (opciones: { manual?: boolean } = {}) => {
      if (opciones.manual) setEstado((previo) => ({ ...previo, cargando: true, errorManual: null }));
      try {
        const cabeceras: HeadersInit = {};
        if (etagRef.current) cabeceras["If-None-Match"] = etagRef.current;
        // `pedir()` (`cliente/aparato.ts`) — la sesión ES el aparato [AC-FIDN-09]: el digest exige
        // `admin_tenant` desde este AC (§2.8) y sin el secreto persistido del dueño no hay con qué
        // pasar la guardia [AC-FSEM-09].
        const r = await pedir(`/api/semaforo/digest?seed=${seed}`, { headers: cabeceras, cache: "no-store" });

        if (r.status === 304) {
          setEstado((previo) => ({
            ...previo,
            conectado: true,
            intentosFallidos: 0,
            ultimoDigestEn: Date.now(),
            cargando: false,
            errorManual: null,
          }));
          return;
        }
        if (!r.ok) throw new Error(`digest respondió ${r.status}`);

        const nuevoEtag = r.headers.get("etag");
        if (nuevoEtag) etagRef.current = nuevoEtag;
        const cuerpo = (await r.json()) as { tarjetas: TarjetaHoy[] };
        setEstado({
          tarjetas: cuerpo.tarjetas.map(revivirFechas),
          conectado: true,
          intentosFallidos: 0,
          ultimoDigestEn: Date.now(),
          cargando: false,
          errorManual: null,
        });
      } catch (e) {
        // `fetch` tira `TypeError` cuando ni siquiera pudo alcanzar la red (offline real, DNS,
        // conexión rechazada) — eso SÍ es «sin conexión» (§2.6). Un `!r.ok` de arriba es un Error
        // normal: el servidor respondió y respondió mal, un hecho DISTINTO que no toca `conectado`
        // (si tocara, un 404/500 pasajero encendería el banner de «sin conexión» sin que la red
        // tuviera nada que ver — el mismo defecto que el AC pide separar).
        const esRedCaida = e instanceof TypeError;
        setEstado((previo) => ({
          ...previo,
          // Sin red (offline real) o el servidor cayó a mitad del poll: se queda con el ÚLTIMO
          // digest bueno — jamás un verde fingido con datos viejos sin decirlo (§2.6).
          conectado: esRedCaida ? false : previo.conectado,
          intentosFallidos: esRedCaida ? previo.intentosFallidos + 1 : previo.intentosFallidos,
          cargando: false,
          errorManual:
            opciones.manual && !esRedCaida ? "No se pudo actualizar «Hoy». Intenta de nuevo." : previo.errorManual,
        }));
      }
    },
    [seed],
  );

  useEffect(() => {
    let temporizador: ReturnType<typeof setInterval> | null = null;

    const detener = () => {
      if (temporizador !== null) {
        clearInterval(temporizador);
        temporizador = null;
      }
    };
    const iniciar = () => {
      if (temporizador !== null) return;
      void refrescar();
      temporizador = setInterval(() => void refrescar(), INTERVALO_MS);
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") iniciar();
      else detener();
    };

    if (document.visibilityState === "visible") iniciar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => {
      detener();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [refrescar]);

  const refrescarAhora = useCallback(() => refrescar({ manual: true }), [refrescar]);

  return { ...estado, refrescarAhora };
}
