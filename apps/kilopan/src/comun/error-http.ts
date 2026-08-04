// AC-SEC-10: un 500 crudo le dice al operador «el servidor se rompió» cuando la mitad de
// las veces el servidor funcionó perfecto y rechazó un dato inválido. La diferencia importa
// en la calle: un 500 no se reintenta —parece culpa nuestra— mientras que un 400 con
// mensaje se corrige y se manda de nuevo. Peor con la cola offline: `enviarOEncolar` trata
// un 5xx como «el servidor está caído, lo reintento» y un 4xx como «este dato el servidor
// no lo va a aceptar nunca, a la bandeja de rechazados». Clasificar mal deja una venta
// reintentándose para siempre contra un error que no se arregla solo.
//
// La clasificación NO se adivina por el texto del mensaje: se lee el `code` de Postgres,
// que es un contrato estable (SQLSTATE) y no cambia con el idioma ni con el wording de un
// trigger. Los errores de la clase 23 (integrity_constraint_violation) y P0001 (el
// `raise exception` de nuestros propios triggers de negocio) son SIEMPRE datos que la BD
// rechaza a propósito — o sea, entrada inválida. Todo lo demás es una excepción de verdad.

/** SQLSTATE que significan «el dato que mandaste no cumple una regla», no «me rompí». */
const CODIGOS_DE_DATO_INVALIDO = new Set([
  "23502", // not_null_violation — falta un campo obligatorio
  "23503", // foreign_key_violation — apunta a algo que no existe
  "23505", // unique_violation — duplicado (p. ej. dos turnos abiertos)
  "23514", // check_violation — rompe un CHECK del esquema
  "22P02", // invalid_text_representation — un uuid/número malformado
  "22001", // string_data_right_truncation — texto más largo que la columna
  "P0001", // raise_exception — nuestros triggers de negocio hablan por acá
]);

export interface ErrorClasificado {
  estado: 400 | 401 | 500;
  /** Mensaje para el operador. En 400 es el de la BD: lo escribimos nosotros en los
   *  triggers y está en español, pensado para leerse en pantalla. */
  mensaje: string;
}

/**
 * Clasifica un error atrapado en una ruta de API.
 *
 * `respaldo` es el mensaje genérico de la ruta para el caso 500 — el único en que de
 * verdad no sabemos qué pasó y no conviene filtrar detalles internos al cliente.
 */
export function clasificarError(err: unknown, respaldo: string): ErrorClasificado {
  const mensaje = err instanceof Error ? err.message : String(err);

  // La sesión vencida ya se distinguía en cada ruta a mano; vive acá para que las 19 la
  // traten igual. Es 401 y no 400: el dato estaba bien, lo que falta es la credencial.
  if (/sin sesión/i.test(mensaje)) {
    return { estado: 401, mensaje: "Sesión vencida" };
  }

  const codigo = (err as { code?: unknown })?.code;
  if (typeof codigo === "string" && CODIGOS_DE_DATO_INVALIDO.has(codigo)) {
    return { estado: 400, mensaje };
  }

  return { estado: 500, mensaje: respaldo };
}
