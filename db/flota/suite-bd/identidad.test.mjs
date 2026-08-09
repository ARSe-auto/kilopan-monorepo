#!/usr/bin/env node
// Esquema §4.3 de identidad y enrolamiento, con el rol de app REAL [AC-FIDN-01].
//
// Lo que es del catálogo —enums, índices, CHECK por nombre, clase del COMMENT— está en
// `db/flota/pgtap/0008_identidad_y_enrolamiento.sql`. Acá va lo que pgTAP no puede probar:
// el COMPORTAMIENTO con el rol `app_t_<slug>` de verdad. A un superusuario, que es como corre
// pgTAP, un REVOKE no le aplica nunca; probar ahí el append-only del §7.4 daría un verde que
// no probó una sola de las dos capas que lo sostienen.
//
// Y una cosa que ninguna suite dentro de la BD puede hacer: comparar el enum de roles contra
// el canónico `ROLES` de `packages/nucleo-comun/src/constants.ts`. Dos listas iguales escritas
// en dos lenguajes se separan el día que alguien toca una sola, y el §0 manda que la del
// canónico sea la única fuente.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import { ROLES } from "../../../packages/nucleo-comun/src/constants.ts";

const SLUG = "gate_identidad";

let tenant;
let app;
let migrador;

/** RUTs sintácticamente válidos e IRREALES (§7.8: cero datos personales reales en seeds). */
const RUT_A = "12.345.678-5";
const RUT_B = "11.111.111-1";
const RUT_K = "20.347.878-K";

/** El SQLSTATE de un rebote, o null si la sentencia pasó. */
async function codigoDe(conexion, sql, params) {
  try {
    await conexion.sql(sql, params);
    return null;
  } catch (e) {
    return e.code ?? "sin-codigo";
  }
}

async function limpiar() {
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`));
  await borrarRolDeApp(SLUG);
}

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

// ─── El enum de roles contra el canónico del §0 ───────────────────────────────────────

test("[AC-FIDN-01] el enum `rol_usuario` de la BD ES la lista canónica de roles, en orden", async () => {
  // El enum es FIJO por decisión del §0: los packs de vertical agregan campos y catálogos,
  // jamás roles. Que sea un tipo de la BD hace que agregar uno sea una migración visible;
  // que se compare contra `constants.ts` hace que no puedan divergir en silencio.
  const filas = await app.sql(
    `select e.enumlabel as rol
       from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'rol_usuario'
      order by e.enumsortorder`,
  );
  assert.deepEqual(filas.map((f) => f.rol), [...ROLES]);
  assert.equal(ROLES.length, 6, "el §0 fija SEIS roles: si cambian, cambia el maestro primero");
});

// ─── RUT: módulo 11 en la BD, con el rol de app ──────────────────────────────────────

test("[AC-FIDN-01] un RUT con dígito verificador equivocado NO entra, ni por el rol de app", async () => {
  // La app valida al escribir (§4.3) para que la persona lo vea antes de enviar. Esto es la
  // red de abajo: un RUT inválido que llega por un script, una carga masiva o un endpoint
  // futuro es igual de inválido, y la BD es la autoridad sobre las reglas de negocio.
  assert.equal(
    await codigoDe(app, "insert into personas (rut, nombre) values ($1, $2)", ["12.345.678-9", "Nadie"]),
    "23514",
  );
  // Sin puntos es OTRO string para el UNIQUE: aceptarlo dejaría dos filas para una persona.
  assert.equal(
    await codigoDe(app, "insert into personas (rut, nombre) values ($1, $2)", ["12345678-5", "Nadie"]),
    "23514",
  );
  // Y el positivo, para que la regla no sea un no-op al revés: los dos válidos entran, K incluido.
  assert.equal(await codigoDe(app, "insert into personas (rut, nombre) values ($1, $2)", [RUT_A, "Ana"]), null);
  assert.equal(await codigoDe(app, "insert into personas (rut, nombre) values ($1, $2)", [RUT_K, "Kai"]), null);
});

test("[AC-FIDN-01] el RUT es único POR TENANT: la segunda persona con el mismo RUT rebota", async () => {
  assert.equal(
    await codigoDe(app, "insert into personas (rut, nombre) values ($1, $2)", [RUT_A, "Otra Ana"]),
    "23505",
  );
});

test("[AC-FIDN-01] la anonimización de la 21.719 es todo o nada", async () => {
  const [p] = await app.sql("insert into personas (rut, nombre) values ($1, $2) returning id::text as id", [
    RUT_B,
    "Beto",
  ]);

  // Poner la fecha y dejar el RUT no es anonimizar: es una fila con una fecha puesta.
  assert.equal(
    await codigoDe(app, "update personas set anonimizada_en = now() where id = $1", [p.id]),
    "23514",
  );
  // Al revés tampoco: una persona VIVA sin RUT ni nombre no se puede volver a identificar.
  assert.equal(await codigoDe(app, "update personas set rut = null where id = $1", [p.id]), "23514");

  // Anonimizar de verdad: se van los identificadores y queda la fila, con su id opaco, para
  // que los hechos del ledger la sigan referenciando sin tocarlos (§7.4, §7.8).
  assert.equal(
    await codigoDe(
      app,
      "update personas set rut = null, nombre = null, contacto = null, anonimizada_en = now() where id = $1",
      [p.id],
    ),
    null,
  );
  const [quedo] = await app.sql("select rut, nombre from personas where id = $1", [p.id]);
  assert.equal(quedo.rut, null);
  assert.equal(quedo.nombre, null);
  // Y el RUT vuelve a estar disponible: el UNIQUE no queda tomado por una fila anonimizada.
  assert.equal(await codigoDe(app, "insert into personas (rut, nombre) values ($1, $2)", [RUT_B, "Otro"]), null);
});

// ─── usuarios: el mapeo cerrado del §4.3 ─────────────────────────────────────────────

test("[AC-FIDN-01] rol `cliente` ⇔ empresa_cliente_id, en los dos sentidos", async () => {
  const [p] = await app.sql("select id::text as id from personas where rut = $1", [RUT_A]);
  const empresa = "0192f0a0-0000-7000-8000-000000000001";

  // Un `cliente` sin empresa vería el portal de nadie: el portal filtra por esa columna.
  assert.equal(
    await codigoDe(app, "insert into usuarios (persona_id, rol) values ($1, 'cliente')", [p.id]),
    "23514",
  );
  // Y un operario CON empresa sería un contratante disfrazado de trabajador.
  assert.equal(
    await codigoDe(app, "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'chofer', $2)", [
      p.id,
      empresa,
    ]),
    "23514",
  );
  // Los dos positivos.
  assert.equal(await codigoDe(app, "insert into usuarios (persona_id, rol) values ($1, 'chofer')", [p.id]), null);
  assert.equal(
    await codigoDe(app, "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2)", [
      p.id,
      empresa,
    ]),
    null,
  );
});

// ─── dispositivos: uno personal activo por operario, y el teléfono nuevo ─────────────

test("[AC-FIDN-01] un solo dispositivo personal ACTIVO por operario, y el re-enrolamiento entra", async () => {
  const [p] = await app.sql("select id::text as id from personas where rut = $1", [RUT_K]);
  const nuevo = () =>
    app.sql("insert into dispositivos (tipo, persona_id) values ('personal', $1) returning id::text as id", [p.id]);

  const [primero] = await nuevo();
  assert.equal(await codigoDe(app, "insert into dispositivos (tipo, persona_id) values ('personal', $1)", [p.id]), "23505");

  // F-E «Ya tengo cuenta», teléfono nuevo: la aprobación revoca el anterior EN EL MISMO acto.
  // Con un UNIQUE total esto sería imposible y el flujo —que es de primera clase, no una
  // excepción— quedaría bloqueado por el índice que protege otra cosa.
  await app.sql("update dispositivos set revocado_at = now() where id = $1", [primero.id]);
  const [segundo] = await nuevo();
  assert.ok(segundo.id);

  // La revocación es SOFT: el aparato viejo sigue en la tabla. Su historia es lo que permite
  // clasificar una captura post-revocación (§4.3, centinela 4) en vez de descartarla.
  const [{ n }] = await app.sql("select count(*)::int as n from dispositivos where persona_id = $1", [p.id]);
  assert.equal(n, 2);
});

test("[AC-FIDN-01] el de andén no tiene persona dueña; el personal no puede no tenerla", async () => {
  const [p] = await app.sql("select id::text as id from personas where rut = $1", [RUT_A]);
  // Un aparato de andén CON persona entraría al índice de «un personal activo por operario»
  // y le bloquearía el teléfono a esa persona.
  assert.equal(
    await codigoDe(app, "insert into dispositivos (tipo, persona_id) values ('anden', $1)", [p.id]),
    "23514",
  );
  assert.equal(await codigoDe(app, "insert into dispositivos (tipo) values ('personal')"), "23514");
  assert.equal(await codigoDe(app, "insert into dispositivos (tipo) values ('anden')"), null);
});

// ─── firmas: la única CAPTURA, append-only por las DOS capas del §7.4 ────────────────

test("[AC-FIDN-01] UPDATE y DELETE sobre `firmas` como rol de app ⇒ 42501 (centinela 6)", async () => {
  const [p] = await app.sql("select id::text as id from personas where rut = $1", [RUT_A]);
  const [d] = await app.sql("select id::text as id from dispositivos where tipo = 'anden' limit 1");
  const [f] = await app.sql(
    `insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado, client_uuid)
     values ($1, $2, 'encargos', uuidv7(), 'recibio_conforme', uuidv7()) returning id::text as id`,
    [p.id, d.id],
  );

  assert.equal(
    await codigoDe(app, "update firmas set significado = 'rechazo' where id = $1", [f.id]),
    "42501",
    "una firma corregida a mano deja de ser prueba de nada",
  );
  assert.equal(await codigoDe(app, "delete from firmas where id = $1", [f.id]), "42501");

  // La OTRA capa: el trigger detiene también a quien tiene más privilegios que la app — un
  // mantenimiento con el rol dueño pasaría por encima del REVOKE. Mismo SQLSTATE por los dos
  // caminos, así que el rebote se ve igual venga de donde venga.
  assert.equal(
    await codigoDe(migrador, "update firmas set significado = 'rechazo' where id = $1", [f.id]),
    "42501",
  );
  assert.equal(await codigoDe(migrador, "truncate firmas"), "42501");
});

test("[AC-FIDN-01] el replay de una firma no crea una segunda fila (centinela 1)", async () => {
  const [p] = await app.sql("select id::text as id from personas where rut = $1", [RUT_A]);
  const [d] = await app.sql("select id::text as id from dispositivos where tipo = 'anden' limit 1");
  const [{ uuid }] = await app.sql("select uuidv7()::text as uuid");
  const enviar = () =>
    app.sql(
      `insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado, client_uuid)
       values ($1, $2, 'encargos', uuidv7(), 'libero', $3)
       on conflict (tenant_id, client_uuid) do nothing`,
      [p.id, d.id, uuid],
    );

  await enviar();
  await enviar();
  const [{ n }] = await app.sql("select count(*)::int as n from firmas where client_uuid = $1", [uuid]);
  assert.equal(n, 1, "el doble replay de la MISMA firma dejó dos filas");
});

// ─── El gobierno queda auditado, por trigger ─────────────────────────────────────────

test("[AC-FIDN-01] toda acción de gobierno escribe `audit_trail` por trigger (§3.E1.14)", async () => {
  // No es un detalle de higiene: la bitácora de accesos del admin (§3.E1.15) se alimenta de
  // acá, y un trigger que se engancha «cuando haga falta» es un trigger que falta el día que
  // alguien pregunta quién revocó a quién.
  const [p] = await app.sql("insert into personas (rut, nombre) values ('7.654.321-6', 'Gob') returning id::text as id");
  const [u] = await app.sql(
    "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
    [p.id],
  );
  await app.sql("update usuarios set activo = false where id = $1", [u.id]);

  const filas = await app.sql(
    "select operacion from audit_trail where tabla = 'usuarios' and registro_id = $1 order by ocurrido_en",
    [u.id],
  );
  assert.deepEqual(filas.map((f) => f.operacion), ["INSERT", "UPDATE"]);
});

// ─── retention_policy: la tabla existe, la purga no ──────────────────────────────────

test("[AC-FIDN-01] ninguna purga se puede encender sin el plazo que el dueño no dio", async () => {
  // El §3.E1.15 manda crear la tabla en E1 y no fija plazos: son la Pregunta 8. Apagada por
  // CONSTRUCCIÓN y no por promesa — el día que lleguen los valores el cambio es un UPDATE, y
  // hasta entonces no hay forma de que una purga se encienda por accidente.
  const [{ n }] = await app.sql("select count(*)::int as n from retention_policy");
  assert.equal(n, 0, "retention_policy nació con filas: alguien inventó un plazo");

  assert.equal(
    await codigoDe(app, "insert into retention_policy (registro, activa) values ('dispositivos_revocados', true)"),
    "23514",
  );
  assert.equal(
    await codigoDe(app, "insert into retention_policy (registro, plazo_dias) values ('evidence', 90)"),
    "23514",
    "no hay retención para lo append-only: del ledger no se purga nada (§7.4)",
  );
  assert.equal(
    await codigoDe(app, "insert into retention_policy (registro, plazo_dias) values ('dispositivos_revocados', 90)"),
    null,
  );
});
