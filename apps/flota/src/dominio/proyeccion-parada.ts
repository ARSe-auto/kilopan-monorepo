// La proyección del estado VISIBLE de una parada, a partir de los hechos que aterrizaron en
// `eventos` [AC-FPOD-21] — §4.6, §2.
//
// El orden que manda es `secuencia` — la que el SERVIDOR asigna al aterrizar cada evento
// (`nextval(eventos_secuencia_seq)`, 0002), creciente por orden de LLEGADA — y NUNCA `event_time`,
// que viaja del dispositivo: un aparato con el reloj corrido, o dos capturas que llegan en el
// orden contrario al que ocurrieron en el terreno (drift, offline), no pueden invertir cuál es
// el hecho VIGENTE. Es la misma razón por la que `eventos.secuencia` existe como columna propia
// y no se deriva ordenando por `event_time`: el reloj del dispositivo es un DATO, no una
// autoridad (§4.6).
//
// Función PURA — no toca la BD. `servidor/paradas.ts::estadoVisibleDeParada` lee `eventos` y le
// pasa la lista; acá solo se decide, dado el orden ya resuelto, qué evento manda. Que sea pura y
// separada del servidor es lo que la hace mutable-a-prueba-de-mutantes: cero contadores, cero
// estado — cada llamada recalcula desde los hechos que recibe, igual que el estado visible de la
// parada se recalcula desde `eventos` y no desde una columna que alguien fue incrementando.

export type EventoDeParada = {
  secuencia: number;
  payload: {
    resultado?: unknown;
    metodo_entrega?: unknown;
    motivo_id?: unknown;
  };
};

export type EstadoVisibleDeParada = {
  estado: "pending" | "done";
  resultado: "exito" | "fallo" | "parcial" | null;
  metodoEntrega: string | null;
  motivoId: string | null;
};

const PENDIENTE: EstadoVisibleDeParada = {
  estado: "pending",
  resultado: null,
  metodoEntrega: null,
  motivoId: null,
};

/** Las tres salidas de F4 (§4.5, mismo catálogo que `servidor/capturas.ts::RESULTADOS`). */
const RESULTADOS = new Set(["exito", "fallo", "parcial"]);

/**
 * Proyecta el estado visible desde la lista de eventos de UNA parada.
 *
 * `eventos` no necesita venir ordenada: se ordena ACÁ por `secuencia` — nunca por otra cosa — y
 * gana el ÚLTIMO, que es el orden autoritativo del servidor (§4.6). Lista vacía = la parada no
 * tiene ningún hecho aterrizado todavía: `pending`, que es lo que la 0037 le da por DEFAULT y
 * que la planificación no mueve.
 */
export function proyectarEstadoDeParada(eventos: readonly EventoDeParada[]): EstadoVisibleDeParada {
  if (eventos.length === 0) return PENDIENTE;

  const ultimo = [...eventos].sort((a, b) => a.secuencia - b.secuencia).at(-1)!;

  const resultado =
    typeof ultimo.payload.resultado === "string" && RESULTADOS.has(ultimo.payload.resultado)
      ? (ultimo.payload.resultado as EstadoVisibleDeParada["resultado"])
      : null;

  // Cualquier resultado válido cierra la parada (§4.5: `resultado` solo existe con
  // `estado in ('done','cancelled')`; acá `cancelled` no lo produce esta captura).
  return {
    estado: resultado ? "done" : "pending",
    resultado,
    metodoEntrega: typeof ultimo.payload.metodo_entrega === "string" ? ultimo.payload.metodo_entrega : null,
    motivoId: typeof ultimo.payload.motivo_id === "string" ? ultimo.payload.motivo_id : null,
  };
}
