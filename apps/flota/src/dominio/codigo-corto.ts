import { INVITACION } from "../../../../packages/nucleo-comun/src/constants.ts";

// El código corto de la invitación, PURO [AC-FIDN-03, AC-FIDN-17] — §0, §5.4 F-A/F-B.
//
// POR QUÉ VIVE APARTE DE `invitaciones.ts`. Aquel archivo abre con
// `import { createHash, randomInt } from "node:crypto"`, y la pantalla de solicitar acceso
// —que corre en el TELÉFONO— necesita normalizar y juzgar la forma del código para no dejar
// enviar un código imposible. Importar el módulo entero arrastraría un polyfill de Node al
// bundle que se descarga con la señal de un galpón.
//
// Se PARTIÓ en vez de copiarse. Una segunda normalización en el cliente y un día alguien
// corrige el alfabeto en una sola de las dos: el código que la persona teclea se acepta en
// pantalla y rebota en el servidor, o al revés. `invitaciones.ts` reexporta lo de acá, así que
// sigue habiendo UNA implementación y los dos lados la comparten.

/** El alfabeto y el largo son del canónico §0: acá no se elige nada, se lee. */
export const ALFABETO = INVITACION.codigo_corto_alfabeto;
export const LARGO = INVITACION.codigo_corto_largo;

/**
 * Normaliza lo que tecleó una persona. Se dicta en voz alta en un galpón y se escribe con
 * guantes: llega en minúscula, con espacios de más o con guiones que alguien puso para
 * leerlo. Nada de esto cambia QUÉ código es, así que rechazarlo sería castigar la forma.
 *
 * Lo que NO se hace es «corregir» caracteres ambiguos mapeando O→0 o l→1: el alfabeto del §0
 * ya los excluye, así que una O no es un cero mal escrito — es un carácter que no existe en
 * ningún código, y aceptarlo mapeándolo abriría códigos que nadie emitió.
 */
export function normalizarCodigo(crudo: string): string | null {
  const limpio = String(crudo ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (limpio.length !== LARGO) return null;
  for (const c of limpio) if (!ALFABETO.includes(c)) return null;
  return limpio;
}

