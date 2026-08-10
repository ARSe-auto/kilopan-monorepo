#!/usr/bin/env node
// Fixture del e2e de ruteo [AC-FTEN-05]: tres tenants REGISTRADOS en `control`, uno por
// estado del enum cerrado, cada uno con su base de verdad provisionada desde la plantilla.
//
// Las bases de los NO activos existen a propósito. Sin ellas, «cero acceso a la base del
// suspendido» sería verdad por accidente —no hay base contra la cual conectarse— y el caso
// que el dueño pidió cerrar quedaría sin probar. Con la base viva, contar conexiones en
// `pg_stat_activity` sí dice algo.
//
// Se recrea en cada corrida, igual que la suite de provisión del gate: un fixture que
// sobrevive entre corridas es un fixture que un día quedó en un estado que nadie escribió.
import { provisionar } from "../../../db/flota/provisionar.mjs";
import { con, BD_CONTROL, bdDeTenant } from "../../../db/flota/conectar.mjs";

/** Un tenant por estado, más el cuarto caso —el subdominio que NO está en `control`— que
 *  por definición no se siembra: su ausencia ES el caso. */
export const TENANTS = [
  { slug: "ruteo_activo", estado: "activo" },
  // DOS activos y no uno. Con uno solo, «el subdominio de A va a la base de A» se puede
  // cumplir por accidente —cualquier base daría ese slug si solo hay una— y el ataque de
  // cabecera falsificada no se puede ni montar: hace falta una segunda base VIVA a la que
  // apuntar. El segundo activo es lo que convierte los dos casos en pruebas de verdad.
  //
  // `vecino` lo marca como el tenant B del centinela 2: el que recibe la identidad sembrada
  // de abajo y del que salen los `ids_de_b` del manifiesto de rutas. Es una marca y no «el
  // segundo de la lista» porque de acá salen identificadores REALES que otro archivo pide por
  // nombre de tabla; el día que alguien reordene la lista, el que se rompa tiene que ser el
  // orden, no la prueba.
  { slug: "ruteo_activo_b", estado: "activo", vecino: true },
  { slug: "ruteo_susp", estado: "suspendido" },
  { slug: "ruteo_arch", estado: "archivado" },
  // Base PROPIA para el panel de gobierno [AC-FIDN-12], y va al FINAL para no correr a los
  // dos primeros activos, que media docena de suites toma por índice.
  //
  // La razón es la misma por la que `anonimizacion`, `firmas` y la segunda mitad de `sesion`
  // tienen la suya: el gobierno escribe en tablas append-only —`eventos`, `audit_trail`— y
  // deja `codigos_puente` con FK a `usuarios`. Compartiendo la base del primer activo, el
  // `delete from usuarios` del `beforeAll` de otra suite rebotaría por esa FK, y el módulo que
  // se pondría rojo sería el que no hizo nada.
  { slug: "gobierno", estado: "activo" },
  // Base PROPIA para las suites que dejan HECHOS append-only [AC-FVEH-04, AC-FVEH-08].
  //
  // `chequeos` y `energy_entry` rebotan el DELETE incluso para el dueño del esquema (§7.4), y
  // de ellos cuelgan turnos y vehículos que por lo tanto tampoco se pueden borrar. Compartiendo
  // la base del primer activo, la suite del alta de vehículos —que necesita una flota VACÍA
  // para probar el estado vacío accionable del §5.7— encontraría los camiones que dejó la de
  // recargas, y la que se pondría roja sería la que no hizo nada. Va al FINAL por lo mismo que
  // `gobierno`: media docena de suites toma los dos primeros activos por índice.
  { slug: "hechos", estado: "activo" },
];

/** Subdominio que jamás se registra. Nombrarlo acá evita que el test lo invente distinto. */
export const SLUG_INEXISTENTE = "ruteo_fantasma";

/** El tenant B del centinela 2, resuelto acá y no por índice en cada spec que lo necesita. */
export const VECINO = TENANTS.find((t) => t.vecino);

/**
 * Identidad REAL en la base del vecino [AC-FIDN-12].
 *
 * Las rutas de gobierno con parámetro se declaran de tipo `recurso` en el manifiesto, y el
 * caso que emite la suite del centinela 2 saca el identificador de la BD de B: le pide a A la
 * invitación de B, el aparato de B, el usuario de B. Sin estas filas ese caso no probaría
 * nada —la suite lo dice con esas palabras y se pone roja antes que pasar en falso—, así que
 * la identidad del vecino es parte del fixture y no del test que la usa.
 *
 * Solo en el vecino. La base del primer activo la comparten las suites de cada módulo, que
 * limpian identidad en su `beforeAll`; sembrarla ahí sería poner filas que otro archivo borra
 * en el segundo siguiente, y encima disputarle el índice «un personal activo por operario».
 *
 * Los RUTs salen de la lista congelada de AC-FIDN-21 (`db/flota/ruts-sinteticos.mjs`).
 */
async function sembrarIdentidadDelVecino(slug) {
  await con(bdDeTenant(slug), async ({ sql }) => {
    const [persona] = await sql(
      "insert into personas (rut, nombre) values ('11.111.111-1', 'Dueña del vecino') returning id::text as id",
    );
    const [usuario] = await sql(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [persona.id],
    );
    await sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
       values ('personal', $1, 'hash-del-vecino-que-no-abre-nada', $2, now())`,
      [persona.id, usuario.id],
    );
    const [invitacion] = await sql(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ('chofer', 'token-hash-del-vecino', now() + interval '7 days', $1)
       returning id::text as id`,
      [usuario.id],
    );
    await sql(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, '7.654.321-6', 'Quien pide en el vecino', '$argon2id$del-vecino', 'clave-del-vecino', 'huella-del-vecino')`,
      [invitacion.id],
    );
    // Y un vehículo del vecino [AC-FVEH-02]: las rutas de gobierno de vehículos llevan
    // parámetro, así que el caso del centinela 2 saca de acá el id REAL con el que A intenta
    // editar y desactivar la flota de B. Sin esta fila el caso no probaría nada, y la suite lo
    // dice con esas palabras antes que pasar en falso.
    const [vehiculo] = await sql(
      "insert into vehiculos (patente, tipo) values ('VECINO1', 'furgón del vecino') returning id::text as id",
    );
    // Y un chequeo con su defecto [AC-FVEH-04]: `/api/defectos/[id]` es de tipo recurso y el
    // caso del centinela 2 saca de acá el id REAL con el que A intenta cerrar —o marcar
    // bloqueante— un defecto del vecino. Las dos direcciones son daño, no solo fuga.
    const [chequeo] = await sql(
      `insert into chequeos (inspectable_tipo, inspectable_id, momento, ts_dispositivo, tz_offset_min)
       values ('vehiculos', $1, 'pre', now(), -240) returning id::text as id`,
      [vehiculo.id],
    );
    await sql("insert into defectos (chequeo_id, item) values ($1, 'luz de freno del vecino')", [
      chequeo.id,
    ]);
    // Y un turno ABIERTO [AC-FVEH-22]: `/api/turnos/[id]/cierre-forzado` es de tipo recurso y
    // el caso del centinela 2 saca de acá el id con el que A intenta cerrarle la jornada al
    // vecino — que además le resolvería una fila de «Por revisar» que su operación no atendió.
    const [config] = await sql("select crear_config_version('fixture del vecino')::text as id");
    await sql("insert into turnos (vehiculo_id, config_version_id) values ($1, $2)", [
      vehiculo.id,
      config.id,
    ]);
  });
}

export async function prepararTenants() {
  for (const { slug } of TENANTS) await provisionar(slug, { recrear: true });
  for (const { slug, vecino } of TENANTS) if (vecino) await sembrarIdentidadDelVecino(slug);

  await con(BD_CONTROL, async (control) => {
    for (const { slug, estado } of TENANTS) {
      await control.sql(
        `insert into tenants (slug, bd, estado) values ($1, $2, $3::tenant_estado)
         on conflict (slug) do update set estado = excluded.estado`,
        [slug, bdDeTenant(slug), estado],
      );
    }
    // El inexistente no debe quedar de una corrida anterior: si quedara, el caso del 404
    // por subdominio desconocido estaría probando otra cosa.
    await control.sql("delete from tenants where slug = $1", [SLUG_INEXISTENTE]);
  });

  console.log(`preparar-tenants: ${TENANTS.map((t) => `${t.slug}=${t.estado}`).join(" · ")}`);
}

if (process.argv[1]?.endsWith("preparar-tenants.mjs")) {
  await prepararTenants();
  process.exit(0);
}
