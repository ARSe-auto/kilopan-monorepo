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
  /** NÚMERO DE LA PETICIÓN EN CURSO, para que una respuesta VIEJA no pise a una nueva.
   *  Sin esto, dos polls en vuelo se pisan por orden de llegada: el que salió antes puede
   *  contestar después y dejar `conectado: true` DESPUÉS de que el más nuevo ya supo que no
   *  hay red. Eso es un verde fingido con datos viejos, justo lo que el §2.6 prohíbe, y no
   *  es teórico: hacía fallar de forma intermitente al e2e de AC-FSEM-06 —el banner aparecía
   *  y desaparecía entre dos aserciones— y con eso pausaba al motor sin causa aparente. */
  const peticionRef = useRef(0);
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
      const mia = ++peticionRef.current;
      /** ¿Sigo siendo la petición más nueva? Si no, mi respuesta ya no dice nada del presente. */
      const vigente = () => mia === peticionRef.current;
      try {
        const cabeceras: HeadersInit = {};
        if (etagRef.current) cabeceras["If-None-Match"] = etagRef.current;
        // `pedir()` (`cliente/aparato.ts`) — la sesión ES el aparato [AC-FIDN-09]: el digest exige
        // `admin_tenant` desde este AC (§2.8) y sin el secreto persistido del dueño no hay con qué
        // pasar la guardia [AC-FSEM-09].
        const r = await pedir(`/api/semaforo/digest?seed=${seed}`, { headers: cabeceras, cache: "no-store" });

        if (!vigente()) return;
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
        if (!vigente()) return;
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
        // Y el OTRO lado del mismo hecho: si el aparato sabe que no hay red, cualquier fallo del
        // poll es «sin conexión», aunque el error no llegue como TypeError. Sin esta mitad,
        // bastaba con que algo devolviera un Error normal —un service worker contestando un
        // error sintético, por ejemplo— para que el banner no apareciera nunca con la red
        // cortada: regresión real de AC-FSEM-06 el 12-ago-2026, atrapada por su propio e2e.
        // `navigator.onLine === false` no puede confundirse con un 404/500 del servidor vivo,
        // que es justo lo que este clasificador vino a separar.
        if (!vigente()) return;
        const esRedCaida = e instanceof TypeError || navigator.onLine === false;
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
