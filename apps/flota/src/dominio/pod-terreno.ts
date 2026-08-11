// El bucle de terreno de F4: el camino feliz de la entrega [AC-FPOD-01] — §5.2 F4, §5.3, §0
// (undo 8 s), §4.7, §7.6.
//
// ─── DOS ACCIONES, Y LA SEGUNDA YA DEJÓ AL CHOFER EN LA PARADA SIGUIENTE ──────────
//
// El §5.2 F4 fija el camino feliz en DOS toques exactos: «Llegué» (1) → «Entregado» (1). El
// §5.3 lo convierte en contrato: «una feature que sube el conteo del camino feliz no se
// mergea». Un contrato así no se defiende con disciplina, se defiende con una máquina: acá el
// avance a la parada siguiente es parte de `entregar`, no un gesto aparte. Nadie puede agregarle
// un «Siguiente» sin que el conteo suba y el e2e se ponga rojo.
//
// ─── EL UNDO DE 8 s ES LA ÚNICA CONFIRMACIÓN, Y POR ESO NO ES UNA ACCIÓN ──────────
//
// Cero modales en terreno (§7.6): el toque de «Entregado» ya escribió la captura y abrió una
// ventana de `UNDO.ventana_ms` para deshacerla (§4.7). Dentro de esa ventana la captura está en
// `pending_undo` y NO ha salido del dispositivo — deshacerla la cancela ANTES del replay y no
// deja rastro, que es exactamente lo que el §4.7 pide. Vencida la ventana pasa a la cola, que
// es lo que el motor de sync replayea.
//
// ─── DÓNDE TERMINA ESTE AC Y EMPIEZA EL DE AL LADO ───────────────────────────────
//
// Acá vive la CONDUCTA del bucle: cuántas acciones cuesta, cuándo avanza, qué hace el undo. La
// cola de salida es la frontera declarada con el resto del módulo 04:
//
//   · persistirla en IndexedDB partida por (tenant, usuario) y replayarla al arrancar y al
//     volver la señal es AC-FPOD-03/04/08/09/10;
//   · la fila `entregas_pod` donde aterriza en el servidor es AC-FPOD-11, y su DDL es trabajo
//     de sesión supervisada — el motor no crea migraciones.
//
// Por eso la captura es un DATO completo desde ya (client_uuid UUIDv7 del §0, doble reloj
// `ts_dispositivo`+`tz_offset_min` del §4.6): el AC que la replaye no tiene que inventarle
// campos, solo llevarla.

import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";

/** El presupuesto del §5.3, escrito UNA vez: «entrega feliz = 2 exactas». */
export const ENTREGA_FELIZ_ACCIONES = 2;

/** Una parada de entrega de la ruta, tal como la tarjeta la muestra (§5.2 F4). */
export type ParadaDeRuta = {
  id: string;
  orden: number;
  destino: string;
  /** La ventana prometida, ya formateada en es-CL, o `null` si la parada no tiene. */
  ventana: string | null;
  bultos: number;
};

/** La captura de una entrega feliz, con lo que el §0 y el §4.6 exigen que viaje con ella. */
export type CapturaDeEntrega = {
  paradaId: string;
  clientUuid: string;
  tsDispositivo: string;
  tzOffsetMin: number;
  resultado: "exito";
  estado: typeof UNDO.estado_local | "por_replicar";
};

/** El sello del dispositivo en el momento del toque: lo pone quien llama, para que la máquina
 *  siga siendo pura y el test pueda fijar el reloj. */
export type SelloDelAparato = {
  clientUuid: string;
  tsDispositivo: string;
  tzOffsetMin: number;
};

export type Recorrido = {
  paradas: ParadaDeRuta[];
  /** La parada en la que está el chofer. Igual a `paradas.length` cuando la ruta terminó. */
  indice: number;
  /** «Llegué» ya tocado en la parada actual. */
  llegada: boolean;
  /** La captura dentro de su ventana de 8 s: todavía no salió del dispositivo. */
  captura: CapturaDeEntrega | null;
  /** Las capturas cuya ventana venció, esperando el replay del motor de sync. */
  cola: CapturaDeEntrega[];
};

export function iniciarRecorrido(paradas: ParadaDeRuta[], indice = 0): Recorrido {
  return { paradas, indice, llegada: false, captura: null, cola: [] };
}

export function paradaActual(r: Recorrido): ParadaDeRuta | null {
  return r.paradas[r.indice] ?? null;
}

/** Acción 1 de 2. Sobre una parada que ya no existe —la ruta terminó— no hace nada. */
export function llegar(r: Recorrido): Recorrido {
  if (paradaActual(r) === null || r.llegada) return r;
  return { ...r, llegada: true };
}

/**
 * Acción 2 de 2: escribe la captura en `pending_undo` Y avanza a la parada siguiente.
 *
 * El avance va ACÁ y no en un toque propio: el §5.2 F4 lo llama «avance automático», y un
 * «Siguiente» aparte serían tres acciones donde el §5.3 fija dos.
 *
 * Entregar sin haber llegado no es una transición del bucle: la tarjeta no ofrece «Entregado»
 * antes de «Llegué», y una máquina que igual lo aceptara dejaría que un doble toque sobre la
 * pantalla anterior cerrara una parada donde el camión nunca estuvo.
 */
export function entregar(r: Recorrido, sello: SelloDelAparato): Recorrido {
  const parada = paradaActual(r);
  if (parada === null || !r.llegada) return r;

  return {
    ...r,
    // La ventana de la captura anterior se cierra sola si la nueva llega antes de los 8 s: dos
    // entregas seguidas son lo normal en un pasillo de galería, y perder la primera por rápido
    // sería perder un hecho del mundo.
    cola: r.captura === null ? r.cola : [...r.cola, { ...r.captura, estado: "por_replicar" }],
    captura: {
      paradaId: parada.id,
      clientUuid: sello.clientUuid,
      tsDispositivo: sello.tsDispositivo,
      tzOffsetMin: sello.tzOffsetMin,
      resultado: "exito",
      estado: UNDO.estado_local,
    },
    indice: r.indice + 1,
    llegada: false,
  };
}

/**
 * El undo dentro de la ventana: la captura se cancela ANTES del replay y jamás sale del
 * dispositivo (§4.7). Devuelve al chofer a la parada que deshizo, y con «Llegué» ya dado: es
 * donde estaba parado cuando se equivocó de botón, no dos pasos atrás.
 */
export function deshacer(r: Recorrido): Recorrido {
  if (r.captura === null) return r;
  const vuelveA = r.paradas.findIndex((p) => p.id === r.captura?.paradaId);
  return { ...r, captura: null, indice: vuelveA === -1 ? r.indice : vuelveA, llegada: vuelveA !== -1 };
}

/** Vencida la ventana, la captura es un hecho: pasa a la cola que el motor de sync replayea. */
export function cerrarLaVentana(r: Recorrido): Recorrido {
  if (r.captura === null) return r;
  return { ...r, captura: null, cola: [...r.cola, { ...r.captura, estado: "por_replicar" }] };
}

/** La ruta terminó: no quedan paradas por delante. */
export function terminado(r: Recorrido): boolean {
  return paradaActual(r) === null;
}
