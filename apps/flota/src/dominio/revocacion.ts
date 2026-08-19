import { REVOCACION } from "../../../../packages/nucleo-comun/src/constants.ts";

// Revocación de un dispositivo y qué pasa con lo que ya venía en camino [AC-FIDN-09].
// §4.3, §5.4 F-F, centinela 4 del §9.3.
//
// LAS DOS MITADES, Y SON OPUESTAS A PROPÓSITO:
//
//   1. Hacia adelante el corte es SECO. El siguiente request del aparato revocado no tiene
//      sesión, sin gracia ni ventana. Eso es lo que hace que «revocar en 1 toque» signifique
//      algo cuando alguien perdió el teléfono en la calle.
//
//   2. Hacia atrás NO SE RECHAZA NADA. El aparato pudo estar dos días sin señal y traer
//      capturas hechas cuando todavía estaba habilitado. Rechazarlas sería perder trabajo del
//      terreno por una decisión administrativa posterior, y el §4.2 lo prohíbe de frente: la
//      captura JAMÁS rebota. Entran, se marcan y alguien las mira.
//
// La ventana que separa «vieja» de «muy vieja» la fija el §4.3 y vive en el canónico §0. No
// cambia si la captura entra o no —siempre entra—, solo cuánto ruido hace al entrar.

export type ClaseDeCaptura = "vigente" | "post_revocacion" | "post_revocacion_tardia";

/**
 * Clasifica una captura que llega de un aparato. `revocadoEn` es null si sigue habilitado.
 *
 * La ventana se mide desde la REVOCACIÓN hasta que la captura LLEGA, que es como lo dice el
 * §4.3 («llegan ≤72 h», «llegan >72 h»), y con el reloj del SERVIDOR. El del dispositivo
 * (§4.6, doble reloj) no sirve para esto: es el único de los dos que se puede correr
 * cambiando la hora del teléfono, y un reloj atrasado convertiría una captura tardía en una
 * reciente — justo la que hay que mirar.
 */
export function clasificar(revocadoEn: Date | null, recibidaEn: Date): ClaseDeCaptura {
  if (revocadoEn === null) return "vigente";
  const horas = (recibidaEn.getTime() - revocadoEn.getTime()) / 3_600_000;
  return horas <= REVOCACION.ventana_horas ? "post_revocacion" : "post_revocacion_tardia";
}

/** El flag que se registra por clase. Los nombres son del §4.3 y viven en el canónico. */
export function flagDe(clase: ClaseDeCaptura): string | null {
  if (clase === "post_revocacion") return REVOCACION.flag_dentro;
  if (clase === "post_revocacion_tardia") return REVOCACION.flag_fuera;
  return null;
}

/**
 * ¿Va a `review_queue`, y con qué severidad? Solo la tardía: el §4.3 le pone severidad alta
 * porque un aparato revocado que sigue sincronizando tres días después ya no se explica por
 * falta de señal, y esa es la diferencia entre una anomalía y un incidente.
 *
 * La que entra dentro de la ventana se marca con su flag y NO abre una fila de revisión: si
 * cada captura demorada generara una, la bandeja se llenaría de ruido el día que un camión
 * pasa una noche en un valle sin cobertura, y la que importa de verdad se perdería entre ellas.
 */
export function revisionDe(clase: ClaseDeCaptura): { severidad: string } | null {
  return clase === "post_revocacion_tardia" ? { severidad: "alta" } : null;
}

/** Ninguna clase rechaza. Está acá como función para que el centinela 4 tenga qué asertar. */
export function rechaza(_clase: ClaseDeCaptura): boolean {
  return false;
}
