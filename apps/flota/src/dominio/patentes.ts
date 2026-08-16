// La patente, normalizada antes de tocar la base [AC-FVEH-01] — §4.5, §5.4, §0 (alcance Chile).
//
// POR QUÉ HAY QUE NORMALIZAR. El §4.5 pide `patente UNIQUE por tenant`, y un UNIQUE sobre el
// texto tal como se tipeó no es único: «AB-1234», «ab 1234» y «AB1234» son tres filas para la
// base y un solo camión para la empresa. El día que eso pasa, el vehículo tiene dos historias
// de odómetro, dos agendas y dos EEVD, y nadie se entera hasta que los números no cuadran.
// Por eso el 422 de patente duplicada del AC se juega ACÁ y no en el índice: el índice es el
// último recurso, la normalización es la que hace que el índice signifique lo que promete.
//
// QUÉ NO SE VALIDA, Y ES DELIBERADO. No se exige el formato de placa patente única chilena
// (`AABB12`, `BBBB12`) ni ningún otro: el §5.4 pide un alta de dos campos en menos de dos
// minutos, y un validador de formato convierte un remolque, una máquina o una placa antigua
// en un vehículo que no se puede dar de alta. Se exige lo mínimo que hace posible el UNIQUE:
// solo letras y dígitos, y un largo con techo para que un pegado accidental no entre.
//
// Chile solamente (§0): no hay formatos de otros países que contemplar acá.

/** Largo máximo aceptado. Techo generoso a propósito: acota el pegado accidental, no la placa. */
export const PATENTE_LARGO_MAX = 12;
/** Piso: la placa chilena más corta que existe tiene cuatro caracteres. */
export const PATENTE_LARGO_MIN = 4;

/**
 * Deja la patente en su forma canónica: mayúsculas, sin separadores ni espacios.
 *
 * Los acentos y la eñe no se contemplan porque no existen en una placa; lo que sí llega del
 * teclado de un teléfono son espacios, guiones y puntos, y son los que se sacan.
 */
export function normalizarPatente(crudo: string): string {
  return String(crudo ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export type PatenteInvalida = "vacia" | "corta" | "larga";
export type VeredictoPatente =
  | { tipo: "ok"; patente: string }
  | { tipo: "invalida"; motivo: PatenteInvalida };

/** El mismo veredicto que ve el servidor y el que ve la pantalla: uno solo, sin copia. */
export function juzgarPatente(crudo: string): VeredictoPatente {
  const patente = normalizarPatente(crudo);
  if (patente.length === 0) return { tipo: "invalida", motivo: "vacia" };
  if (patente.length < PATENTE_LARGO_MIN) return { tipo: "invalida", motivo: "corta" };
  if (patente.length > PATENTE_LARGO_MAX) return { tipo: "invalida", motivo: "larga" };
  return { tipo: "ok", patente };
}

/** Lo que se le dice a la persona. En es-CL y sin jerga: quien da de alta no lee códigos. */
export const MENSAJE_PATENTE: Record<PatenteInvalida, string> = {
  vacia: "Escribí la patente del vehículo.",
  corta: "Esa patente es demasiado corta. Revisala y volvé a escribirla.",
  larga: "Esa patente es demasiado larga. Revisala y volvé a escribirla.",
};

/** El tipo del vehículo: texto libre acotado, porque el maestro no cierra el catálogo. */
export const TIPO_LARGO_MAX = 40;

/**
 * El tipo se normaliza apenas recortando y colapsando espacios. NO se pasa a mayúsculas ni se
 * mapea contra una lista: el maestro pide «tipo (chips)» sin enumerar los chips en ninguna
 * parte, y esta spec lo pregunta (spec 02, pregunta 15). Inventar acá una lista cerrada sería
 * responder por el dueño, y una lista mal elegida se convierte en el vehículo que no se puede
 * dar de alta. Los chips de la pantalla salen de los tipos que ESTE tenant ya usó.
 */
export function normalizarTipo(crudo: string): string {
  return String(crudo ?? "").trim().replace(/\s+/g, " ");
}

export function juzgarTipo(crudo: string): { tipo: "ok"; valor: string } | { tipo: "invalida" } {
  const valor = normalizarTipo(crudo);
  if (valor.length === 0 || valor.length > TIPO_LARGO_MAX) return { tipo: "invalida" };
  return { tipo: "ok", valor };
}
