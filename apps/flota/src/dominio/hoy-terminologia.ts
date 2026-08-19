import { LABELS } from "../../../../packages/nucleo-comun/src/constants.ts";
import type { ColorSemaforo } from "./semaforo.ts";

// Terminología renombrable del Nivel 0 de «Hoy» [AC-FSEM-12] — spec 05, criterio «snapshot
// 375px con términos del tenant B al máximo largo sin truncar cifras» + «la e2e del módulo
// corre DOS veces (terminología base y extrema) sin cambiar un selector (data-testid/term_key)».
//
// La capa de copy CON RESOLUCIÓN `term_key` real (tenant → vertical → base es-CL, diccionario
// en `tenant_terminology`) es AC-FMIG-04 (módulo 08) — no construida todavía: no hay migración,
// no hay endpoint, no hay un solo `term_key` en todo el repo (se verificó antes de escribir esto).
// Este módulo no la adelanta ni la inventa. Lo que SÍ puede probar hoy, sin esa tubería, es la
// propiedad que el AC exige del LADO DE LA PANTALLA: que los `data-testid` no dependen del texto
// visible, así que el día que AC-FMIG-04 exista, enchufar `tenant_terminology` acá es cambiar de
// dónde sale este objeto — nunca un selector de test. Los dos únicos elementos renombrables que
// esta pantalla renderiza (la etiqueta de color y la palabra «excepción/excepciones», §5.6-N0)
// llevan su propia variante «extrema» calibrada al LARGO MÁXIMO que el propio `LABELS.largo_max`
// permite (no un número inventado) — el tenant B de referencia de esta familia de specs es,
// precisamente, el que elige el término más largo permitido por cada tipo.
export type TerminologiaHoy = {
  etiquetaColor: Record<ColorSemaforo, string>;
  excepcionSingular: string;
  excepcionPlural: string;
};

export const TERMINOLOGIA_BASE: TerminologiaHoy = {
  etiquetaColor: { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo" },
  excepcionSingular: "excepción",
  excepcionPlural: "excepciones",
};

/** Tenant B (referencia «extrema» del conjunto de specs): mismo tipo `navegacion` (≤12) para la
 *  etiqueta de color, mismo tipo `titulo` (≤24) para la palabra de excepción — al máximo largo
 *  que el CHECK de `tenant_terminology` permitiría, para forzar el caso «sin truncar cifras». */
export const TERMINOLOGIA_EXTREMA_TENANT_B: TerminologiaHoy = {
  etiquetaColor: {
    verde: "Todo va bien", // 12 — LABELS.largo_max.navegacion
    amarillo: "Alerta media", // 12
    rojo: "Muy urgente!", // 12
  },
  excepcionSingular: "incidencia operativa", // 20 — bajo LABELS.largo_max.titulo (24)
  excepcionPlural: "incidencias operativas", // 22
};

export function resolverTerminologia(param: string | undefined): TerminologiaHoy {
  return param === "extremo" ? TERMINOLOGIA_EXTREMA_TENANT_B : TERMINOLOGIA_BASE;
}

// Invariante que este archivo se compromete a mantener: la extrema nunca EXCEDE el límite de
// largo del tipo que declara imitar — si lo excediera, `tenant_terminology` real la rebotaría
// (AC-FTEN-10) y esta pantalla estaría demostrando un caso que el sistema jamás dejaría guardar.
for (const [color, texto] of Object.entries(TERMINOLOGIA_EXTREMA_TENANT_B.etiquetaColor)) {
  if (texto.length > LABELS.largo_max.navegacion) {
    throw new Error(`etiquetaColor.${color} extrema mide ${texto.length}, sobre LABELS.largo_max.navegacion`);
  }
}
if (TERMINOLOGIA_EXTREMA_TENANT_B.excepcionPlural.length > LABELS.largo_max.titulo) {
  throw new Error("excepcionPlural extrema excede LABELS.largo_max.titulo");
}
