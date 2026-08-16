import { LABELS } from "../../../../packages/nucleo-comun/src/constants.ts";

// Terminología renombrable de las 4 pantallas del portal [AC-FPOR-12] — spec 07, criterio
// «snapshot 375px con términos al máximo largo sin truncar cifras» + «la e2e del portal corre
// DOS veces (terminología base y extrema del tenant B) sin cambiar un selector».
//
// Mismo criterio que `hoy-terminologia.ts` (AC-FSEM-12): la capa de copy con resolución
// `term_key` real (tenant → vertical → base es-CL) es AC-FMIG-04 (módulo 08), no construida
// todavía — no hay migración, no hay endpoint, ningún `term_key` en el repo. Este módulo no la
// adelanta. Lo que SÍ prueba, del lado de la pantalla, es que los `data-testid` no dependen del
// texto visible: el día que AC-FMIG-04 exista, enchufarla acá es cambiar de dónde sale este
// objeto, nunca un selector de test.
//
// Los tres grupos elegidos son los ÚNICOS elementos de copy que las 4 pantallas repiten
// (estado de encargo en «Hoy»/«Encargos», estado de liquidación y resultado de entrega en
// «Encargos»/«Liquidación») — no se inventan más para no adelantar copy que ninguna pantalla
// muestra hoy.
export type TerminologiaPortal = {
  estadoEncargo: Record<"solicitado" | "aceptado", string>;
  estadoLiquidacion: Record<"abierta" | "cerrada" | "pagada", string>;
  resultadoEntrega: Record<"exito" | "parcial" | "fallo", string>;
};

export const TERMINOLOGIA_PORTAL_BASE: TerminologiaPortal = {
  estadoEncargo: { solicitado: "Solicitado", aceptado: "Aceptado" },
  estadoLiquidacion: { abierta: "Abierta", cerrada: "Cerrada", pagada: "Pagada" },
  resultadoEntrega: { exito: "Entregado", parcial: "Entrega parcial", fallo: "No entregado" },
};

/** Tenant B (referencia «extrema» del conjunto de specs): tipo `titulo` (≤24) para las tres
 *  familias — son etiquetas de estado dentro de una tarjeta, no chips de navegación — al máximo
 *  largo que el CHECK de `tenant_terminology` permitiría. */
export const TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B: TerminologiaPortal = {
  estadoEncargo: {
    solicitado: "Solicitud pendiente", // 19
    aceptado: "Confirmado y en curso", // 21
  },
  estadoLiquidacion: {
    abierta: "En curso de cálculo", // 19
    cerrada: "Cerrada, en revisión", // 20
    pagada: "Pagada y conciliada", // 19
  },
  resultadoEntrega: {
    exito: "Entrega confirmada", // 18
    parcial: "Entrega incompleta", // 18
    fallo: "No se pudo entregar", // 19
  },
};

export function resolverTerminologiaPortal(param: string | undefined): TerminologiaPortal {
  return param === "extremo" ? TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B : TERMINOLOGIA_PORTAL_BASE;
}

// Invariante que este archivo se compromete a mantener: la extrema nunca EXCEDE el límite del
// tipo que declara imitar — si lo excediera, `tenant_terminology` real la rebotaría (AC-FTEN-10)
// y esta pantalla estaría demostrando un caso que el sistema jamás dejaría guardar.
for (const [grupo, valores] of Object.entries(TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B)) {
  for (const [clave, texto] of Object.entries(valores)) {
    if (texto.length > LABELS.largo_max.titulo) {
      throw new Error(`${grupo}.${clave} extrema mide ${texto.length}, sobre LABELS.largo_max.titulo`);
    }
  }
}
