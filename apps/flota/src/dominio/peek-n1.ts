import type { EstadoDominio, ExcepcionCruda } from "./semaforo.ts";

// Peek N1 del «Hoy» (spec 05, §2.2) [AC-FSEM-04].
//
// El ORDEN es severidad × antigüedad: primero rojo, luego amarillo, y dentro de cada
// severidad la más antigua por `record_time` primero — la misma fuente de verdad que el
// Nivel 0 usa para «la excepción más antigua» (AC-FSEM-01), no un timestamp de cliente.
//
// La TRANSICIÓN nueva→reconocida y el 422 de re-reconocer viven del lado del servidor
// (`servidor/review-queue.ts`), contra `review_queue` real: esa tabla ya existe (migración
// 0002, módulo 00) y es mutable con auditoría por trigger — no hay nada que este AC deba
// esperar de un módulo futuro para probar el mecanismo de verdad. Lo que SÍ queda pendiente
// (AC-FSEM-06/09, igual que el digest de Nivel 0) es la EVALUACIÓN automática que llena esa
// cola desde `signal_rule`; mientras tanto, la pantalla de «Hoy» sigue sobre las semillas de
// `semaforo-fixtures.ts` y este archivo solo agrega los campos que el peek necesita mostrar.

export type SeveridadPeek = "amarillo" | "rojo";
export type EstadoExcepcionPeek = "nueva" | "reconocida";

export type FilaPeek = {
  id: string;
  dominio: string;
  severidad: SeveridadPeek;
  quien: string;
  que: string;
  cuanto: string;
  /** `record_time` del servidor — la secuencia monotónica por tenant, nunca el reloj del
   *  dispositivo (§4.6, mismo criterio que la «más antigua» del Nivel 0). */
  desde: Date;
  playbook: string;
  estado: EstadoExcepcionPeek;
};

const RANGO_SEVERIDAD: Record<SeveridadPeek, number> = { rojo: 0, amarillo: 1 };

/**
 * Severidad × antigüedad (§2.2). El rango de severidad decide primero: una excepción roja
 * de hace 5 minutos va ANTES que una amarilla de hace 9 horas — si la antigüedad mandara
 * sola, el rojo más urgente se perdería al fondo de la lista.
 */
export function ordenarPeek(filas: FilaPeek[]): FilaPeek[] {
  return [...filas].sort((a, b) => {
    const porSeveridad = RANGO_SEVERIDAD[a.severidad] - RANGO_SEVERIDAD[b.severidad];
    if (porSeveridad !== 0) return porSeveridad;
    return a.desde.getTime() - b.desde.getTime();
  });
}

/** Una excepción cruda sin los campos del peek es una fila que no se puede mostrar de verdad
 *  (§2.2 exige quién/qué/cuánto/desde/playbook en cada una) — se descarta en vez de rendir un
 *  hueco, mismo espíritu que «playbook vacío rebota» del §2.4. */
function esFilaCompleta(
  e: ExcepcionCruda,
): e is ExcepcionCruda & Required<Pick<ExcepcionCruda, "quien" | "que" | "cuanto" | "playbook" | "severidad" | "estado">> {
  return (
    typeof e.quien === "string" &&
    typeof e.que === "string" &&
    typeof e.cuanto === "string" &&
    typeof e.playbook === "string" &&
    (e.severidad === "amarillo" || e.severidad === "rojo") &&
    (e.estado === "nueva" || e.estado === "reconocida")
  );
}

/** Las filas del peek para UN dominio, ya ordenadas por severidad × antigüedad. */
export function filasPeekDeDominio(estado: EstadoDominio): FilaPeek[] {
  const filas = estado.excepciones.filter(esFilaCompleta).map(
    (e): FilaPeek => ({
      id: e.id,
      dominio: estado.clave,
      severidad: e.severidad,
      quien: e.quien,
      que: e.que,
      cuanto: e.cuanto,
      desde: e.record_time,
      playbook: e.playbook,
      estado: e.estado,
    }),
  );
  return ordenarPeek(filas);
}
