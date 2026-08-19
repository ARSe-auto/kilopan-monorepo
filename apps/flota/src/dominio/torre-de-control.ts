import { RASTREO } from "../../../../packages/nucleo-comun/src/constants.ts";

// La antigüedad honesta de una posición, para la torre de control del gestor [AC-FTEL-04] —
// §5.7, §11.
//
// Función PURA a propósito, mismo criterio que `rastreo.ts::estadoDeRastreo` (AC-FTEL-01): el
// componente de pantalla la usa para decidir QUÉ dice, y un test de node:test la ejerce sin
// abrir un navegador ni una conexión.
//
// SIEMPRE contra `recibida_en` (reloj del SERVIDOR), JAMÁS contra `capturada_en` (reloj del
// TELÉFONO) — es la mitad del doble reloj que la 0075 deja escrita para este AC exacto: «es el
// que la torre de control usa para la antigüedad del dato». Un chofer con la hora del aparato
// adelantada o atrasada no puede maquillar cuán vieja es su última posición para el gestor.

export type AntiguedadDePosicion = { minutos: number; texto: string; desactualizada: boolean };

export function antiguedadDePosicion(recibidaEn: string, ahora: Date): AntiguedadDePosicion {
  const diffMs = Math.max(0, ahora.getTime() - new Date(recibidaEn).getTime());
  const minutos = Math.floor(diffMs / 60_000);
  // «Más de 10 min» del AC es estricto: exactamente el umbral todavía no es mentira de UI, y
  // comparar contra el ms crudo (no el minuto ya redondeado hacia abajo) evita que 10 min y 40 s
  // —que ya pasó el umbral— se cuente como si no lo hubiera hecho.
  const desactualizada = diffMs > RASTREO.umbral_desactualizada_min * 60_000;
  const texto = minutos < 1 ? "hace instantes" : `hace ${minutos} min`;
  return { minutos, texto, desactualizada };
}
