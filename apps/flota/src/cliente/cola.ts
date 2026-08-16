"use client";

import { useEffect, useState } from "react";
import {
  leerOutbox,
  leerOutboxRecarga,
  listarIdentidadesConOutbox,
  type AlmacenLocal,
} from "./outbox-local.ts";

// La profundidad REAL de la cola de salida, para el cuarto estado obligatorio [AC-FMIG-10]
// — §5.7: «sin conexión con contador REAL de cola».
//
// ─── POR QUÉ ESTO NO ES UN NÚMERO DE LA PANTALLA ────────────────────────────────────
//
// El §5.7 no pide un cartel de «sin conexión»: pide el contador de la cola. La diferencia es
// exactamente el daño que el maestro nombra — un cartel fijo dice lo mismo con 0 capturas
// esperando que con 12, y quien lo mira aprende a ignorarlo. Acá el número sale de CONTAR las
// capturas que de verdad están guardadas en el aparato, así que un 0 significa «no queda nada
// por subir» y un 3 significa que hay tres hechos que el servidor todavía no acusó.
//
// ─── Y POR QUÉ CUENTA LAS DE TODAS LAS IDENTIDADES ──────────────────────────────────
//
// El outbox está particionado por identidad (§4.7, AC-FPOD-09): las capturas de A siguen en el
// aparato aunque ahora esté B adentro. Contar solo la partición activa mostraría un 0 tranquilo
// con entregas de otra persona esperando señal — el relevo de turno en un equipo compartido es
// justo el momento en que ese 0 sería mentira.
export function profundidadDeCola(almacen: AlmacenLocal): number {
  return listarIdentidadesConOutbox(almacen).reduce(
    (total, identidad) =>
      total + leerOutbox(almacen, identidad).length + leerOutboxRecarga(almacen, identidad).length,
    0,
  );
}

/** El par del contador para una pantalla: profundidad real de la cola + si el aparato tiene red.
 *
 *  Los dos datos van juntos porque separados mienten (mismo hallazgo que `ChipEstadoConexion`):
 *  «pendientes > 0» no es «sin conexión» —puede ser un lote recién encolado con señal— y estar
 *  sin señal con la cola vacía sigue siendo estar sin señal.
 *
 *  Arranca en `pendientes: 0` y `online: true` a propósito: en el primer render del servidor no
 *  existen `localStorage` ni `navigator`, y suponer lo peor pintaría un «sin conexión» que se
 *  desmiente solo al hidratar. */
export function useEstadoDeCola(): { pendientes: number; online: boolean } {
  const [estado, setEstado] = useState({ pendientes: 0, online: true });

  useEffect(() => {
    const releer = () =>
      setEstado({ pendientes: profundidadDeCola(window.localStorage), online: navigator.onLine });
    releer();
    window.addEventListener("online", releer);
    window.addEventListener("offline", releer);
    // `storage` es el aviso que da el navegador cuando OTRA pestaña del mismo origen escribe:
    // la pantalla de terreno encolando en una pestaña y el panel abierto en otra es el caso
    // normal en un aparato compartido, y sin esto el contador del panel se quedaría viejo.
    window.addEventListener("storage", releer);
    return () => {
      window.removeEventListener("online", releer);
      window.removeEventListener("offline", releer);
      window.removeEventListener("storage", releer);
    };
  }, []);

  return estado;
}
