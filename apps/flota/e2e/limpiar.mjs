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

/** De lo que apunta a lo apuntado: los defectos cuelgan de los chequeos, y los chequeos, los
 *  bloques, los turnos y los documentos cuelgan de los vehículos. Agregar una tabla acá es la
 *  ÚNICA edición que pide una tabla nueva del módulo.
 *
 *  `chequeos` NO está en la lista y no puede estarlo: es append-only (§7.4) y su trigger rebota
 *  el DELETE también para el dueño del esquema. Las suites que lo miran cuentan por diferencia.
 *  Como `chequeos.inspectable_id` es polimórfico y no lleva FK, borrar vehículos no lo toca. */
export const TABLAS_DE_OPERACION = [
  "defectos",
  "bloques_agenda",
  "vehiculo_documentos",
  "vehiculos",
];

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
 * La bandeja y lo que cuelga de ella: rutas (con sus paradas e ítems en cascada), encargos,
 * destinos y empresas [AC-FRUT-04].
 *
 * Va en el mismo lugar y por la misma razón que el resto: `items` apunta a `encargos` sin
 * cascada, así que las rutas se van primero o el borrado de la bandeja rebota. Una suite que
 * escriba su propia lista vuelve a pagar ese costo en el AC siguiente.
 */
export async function limpiarBandeja(sql) {
  await sql("delete from rutas");
  await sql("delete from encargos");
  await sql("delete from destinos");
  // Desde AC-FRUT-12 un usuario `cliente` apunta a SU empresa, así que las empresas no se pueden
  // borrar mientras exista uno. Se van con ella y sus aparatos primero: un contratante sin
  // empresa no es un usuario huérfano, es un estado que el CHECK de `usuarios` prohíbe.
  await sql(
    `delete from dispositivos d
      where exists (select 1 from usuarios u
                     where u.persona_id = d.persona_id and u.empresa_cliente_id is not null)`,
  );
  await sql("delete from usuarios where empresa_cliente_id is not null");
  await sql("delete from empresas_cliente");
}

/**
 * Deja la base del fixture sin operación ni identidad.
 *
 * `sql` es el de `conectar.mjs`. Se le pasa la función y no la conexión para que la suite
 * decida si abre una propia o reusa la que ya tiene.
 */
export async function limpiarFixture(sql) {
  await limpiarOperacion(sql);
  for (const tabla of TABLAS_DE_IDENTIDAD) await sql(`delete from ${tabla}`);
}

/**
 * Solo la operación: para las suites que arman su identidad aparte y no quieren perderla.
 *
 * LO QUE NO SE BORRA, Y POR QUÉ. Los hechos append-only del §7.4 —`chequeos`, `energy_entry`,
 * `reading`, `eventos`— rebotan el DELETE incluso para el dueño del esquema. Lo que cuelga de
 * ellos tampoco se puede borrar, así que un turno con chequeos o un vehículo con recargas se
 * QUEDAN. Es la conducta correcta: esa jornada dejó un hecho firmado y la historia no se tira.
 * Por eso acá se excluyen con un `not exists` en vez de intentar el borrado y morir con un
 * error de restricción que no dice qué falta.
 */
export async function limpiarOperacion(sql) {
  // `rutas` va PRIMERO de todo: apunta a `vehiculos` y arrastra en cascada sus paradas, sus
  // ítems y los `stop_requirement` derivados. Sin esto, borrar un vehículo del fixture rebota
  // con una restricción que no dice qué falta.
  await sql("delete from rutas");
  await sql("delete from defectos");
  await sql("delete from bloques_agenda");
  await sql(
    `delete from turnos t
      where not exists (select 1 from chequeos c where c.turno_id = t.id)
        and not exists (select 1 from energy_entry e where e.turno_id = t.id)`,
  );
  // `vehicle_certification` es PLANIFICACIÓN y se borra sin problema: desde AC-FVEH-14 tiene
  // FK a `vehiculos`, así que va antes.
  await sql("delete from vehicle_certification");
  await sql("delete from vehiculo_documentos");
  await sql(
    `delete from vehiculos v
      where not exists (select 1 from energy_entry e where e.vehiculo_id = v.id)
        and not exists (select 1 from turnos t where t.vehiculo_id = v.id)`,
  );
}
