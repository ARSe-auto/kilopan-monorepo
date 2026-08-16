import type { FilaPeek } from "./peek-n1.ts";

// Detalle N2 (spec 05, §2.3) [AC-FSEM-05].
//
// Este archivo solo arma el MODELO de la pantalla de detalle a partir de una fila del peek
// (AC-FSEM-04) más su timeline y evidencia — la EVALUACIÓN real que llenaría esos datos desde
// `eventos`/`evidence` queda pendiente de AC-FSEM-06/09, mismo criterio que el resto del
// módulo (`semaforo.ts`, `peek-n1.ts`): el mecanismo se construye y se prueba de verdad hoy,
// sobre el estado ya evaluado.
//
// «Degradando sin hueco» (§2.3, §7.8) se modela devolviendo SIEMPRE los 4 tipos de evidencia
// en el mismo orden, cada uno marcado `presente: true|false` — nunca se omite un tipo porque
// falte: eso sería el hueco que la spec prohíbe. Un tipo ausente es una fila con su lugar, no
// una fila que no está.

export type EventoTimelineN2 = { id: string; texto: string; cuando: Date };

/** Los 4 tipos de evidencia del §2.3: foto, GPS estático, curva SOC, registros de sync. */
export const TIPOS_EVIDENCIA_N2 = ["foto", "gps", "soc", "sync"] as const;
export type TipoEvidenciaN2 = (typeof TIPOS_EVIDENCIA_N2)[number];

export type EvidenciaN2 =
  | { tipo: TipoEvidenciaN2; presente: true; detalle: string }
  | { tipo: TipoEvidenciaN2; presente: false };

export type DetalleN2 = FilaPeek & {
  timeline: EventoTimelineN2[];
  evidencia: EvidenciaN2[];
};

/**
 * Arma el detalle N2 de una excepción. `evidenciaPresente` trae SOLO los tipos que sí
 * existen para este caso — lo que falta en el objeto es exactamente lo que degrada, y esta
 * función es la que convierte esa ausencia en una fila explícita en vez de en un hueco.
 */
export function construirDetalleN2(
  fila: FilaPeek,
  timeline: EventoTimelineN2[],
  evidenciaPresente: Partial<Record<TipoEvidenciaN2, string>>,
): DetalleN2 {
  const evidencia: EvidenciaN2[] = TIPOS_EVIDENCIA_N2.map((tipo) => {
    const detalle = evidenciaPresente[tipo];
    return detalle === undefined ? { tipo, presente: false } : { tipo, presente: true, detalle };
  });
  return { ...fila, timeline, evidencia };
}
