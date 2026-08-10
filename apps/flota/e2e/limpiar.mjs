// El orden de limpieza de los fixtures, en UN solo lugar [AC-FVEH-07].
//
// POR QUÉ EXISTE. Cada suite armaba su `beforeAll` con su propia lista de `delete`, y el orden
// lo dictan las FK: lo que apunta antes que lo apuntado. Funcionó mientras las tablas fueron
// tres. Al llegar `turnos` hubo que tocar dos suites; al llegar `bloques_agenda`, cuatro — y la
// que se ponía roja era siempre la que no había cambiado, con un error de restricción que no
// dice «te falta un delete» sino «violates foreign key constraint». Es exactamente la clase de
// costo que crece con cada tabla del módulo, y quedan cinco por venir.
//
// Acá el orden se escribe UNA vez. Una tabla nueva se agrega arriba de la que referencia y
// todas las suites se enteran solas.
//
// LO QUE NO SE PUEDE BORRAR, y por eso no está en ninguna lista: `eventos`, `audit_trail`,
// `reading`, `evidence` y `client_metric` son append-only (§7.4) y rebotan el DELETE con
// 42501. Las suites que las miran cuentan por DIFERENCIA, no por total.

/** De lo que apunta a lo apuntado: los bloques, los turnos y los documentos cuelgan de los
 *  vehículos. Agregar una tabla acá es la ÚNICA edición que pide una tabla nueva del módulo. */
export const TABLAS_DE_OPERACION = ["bloques_agenda", "turnos", "vehiculo_documentos", "vehiculos"];

/** Igual, para el plano de identidad: los códigos puente cuelgan de los usuarios. */
export const TABLAS_DE_IDENTIDAD = [
  "codigos_puente",
  "solicitudes_acceso",
  "invitaciones",
  "dispositivos",
  "usuarios",
  "personas",
];

/**
 * Deja la base del fixture sin operación ni identidad.
 *
 * `sql` es el de `conectar.mjs`. Se le pasa la función y no la conexión para que la suite
 * decida si abre una propia o reusa la que ya tiene.
 */
export async function limpiarFixture(sql) {
  for (const tabla of [...TABLAS_DE_OPERACION, ...TABLAS_DE_IDENTIDAD]) {
    await sql(`delete from ${tabla}`);
  }
}

/** Solo la operación: para las suites que arman su identidad aparte y no quieren perderla. */
export async function limpiarOperacion(sql) {
  for (const tabla of TABLAS_DE_OPERACION) await sql(`delete from ${tabla}`);
}
