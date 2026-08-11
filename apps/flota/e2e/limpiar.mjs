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

/** Igual, para el plano de identidad: los códigos puente cuelgan de los usuarios.
 *
 *  `usuarios` NO siempre se puede borrar: desde AC-FRUT-08 un acto de custodia guarda su ACTOR,
 *  y ese acto es append-only. Quien amparó o bajó una carga se queda — es justamente el dato que
 *  hace que la vía sea explícita y no un override anónimo. `limpiarFixture` los excluye. */
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
  // Las rutas cuyas paradas ya tienen un manifiesto NO se borran: `manifiestos` es append-only
  // (§7.4) y su FK sostiene la parada. Es la conducta correcta —esa carga se firmó y la historia
  // no se tira— y por eso se excluyen con `not exists` en vez de intentar el borrado y morir con
  // un error de restricción que no dice qué falta.
  await sql(
    `delete from rutas r
      where not exists (
        select 1 from paradas p join manifiestos m on m.parada_id = p.id where p.ruta_id = r.id
      )`,
  );
  // Los encargos con ítems vivos se QUEDAN: sus ítems cuelgan de una parada que un manifiesto
  // firmado sostiene, y esa carga no se tira.
  await sql(
    "delete from encargos e where not exists (select 1 from items i where i.encargo_id = e.id)",
  );
  await sql(
    `delete from destinos d
      where not exists (select 1 from encargos e where e.destino_id = d.id)
        and not exists (select 1 from paradas p where p.destino_id = d.id)`,
  );
  // Desde AC-FRUT-12 un usuario `cliente` apunta a SU empresa, así que las empresas no se pueden
  // borrar mientras exista uno. Se van con ella y sus aparatos primero: un contratante sin
  // empresa no es un usuario huérfano, es un estado que el CHECK de `usuarios` prohíbe.
  await sql(
    `delete from dispositivos d
      where exists (select 1 from usuarios u
                     where u.persona_id = d.persona_id and u.empresa_cliente_id is not null)`,
  );
  await sql("delete from usuarios where empresa_cliente_id is not null");
  await sql(
    `delete from empresas_cliente ec
      where not exists (select 1 from encargos e where e.empresa_cliente_id = ec.id)
        and not exists (select 1 from manifiestos m where m.empresa_cliente_id = ec.id)`,
  );
}

/**
 * Deja la base del fixture sin operación ni identidad.
 *
 * `sql` es el de `conectar.mjs`. Se le pasa la función y no la conexión para que la suite
 * decida si abre una propia o reusa la que ya tiene.
 */
export async function limpiarFixture(sql) {
  await limpiarOperacion(sql);
  for (const tabla of TABLAS_DE_IDENTIDAD) {
    if (tabla === "usuarios") {
      // Los que firmaron un acto de custodia se quedan: ese acto es append-only y su ACTOR es
      // lo que lo hace explícito. Borrarlos dejaría una bajada de carga sin nadie detrás.
      await sql(
        `delete from usuarios u
          where not exists (
            select 1 from manifiesto_item_documento d where d.actor_id = u.id
          )`,
      );
      continue;
    }
    if (tabla === "dispositivos") {
      // Un dispositivo donde se FIRMÓ no se borra: `firmas` es append-only (§7.4) y lo
      // referencia. El aparato en que alguien firmó es parte de la prueba, no un detalle.
      await sql(
        "delete from dispositivos d where not exists (select 1 from firmas f where f.dispositivo_id = d.id)",
      );
      continue;
    }
    if (tabla === "personas") {
      await sql(
        `delete from personas p
          where not exists (select 1 from usuarios u where u.persona_id = p.id)
            and not exists (select 1 from firmas f where f.persona_id = p.id)
            and not exists (select 1 from dispositivos d where d.persona_id = p.id)`,
      );
      continue;
    }
    await sql(`delete from ${tabla}`);
  }
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
  //
  // Las que tienen una parada con manifiesto se QUEDAN: `manifiestos` es append-only (§7.4) y esa
  // carga se firmó. Es la misma regla que deja en pie un turno con chequeos.
  await sql(
    `delete from rutas r
      where not exists (
        select 1 from paradas p join manifiestos m on m.parada_id = p.id where p.ruta_id = r.id
      )`,
  );
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
        and not exists (select 1 from turnos t where t.vehiculo_id = v.id)
        and not exists (select 1 from rutas r where r.vehiculo_id = v.id)`,
  );
}
