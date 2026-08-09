#!/usr/bin/env node
// El plano de control y el centinela 14 [AC-FTEN-04].
//
// La regla de `control` es lo que NO tiene. Por eso la prueba principal no es «existen estas
// tablas» sino DOS listas literales: qué tablas hay (ninguna de dominio operativo) y qué
// columnas tiene el agregado del exportador (ninguna de dinero, tarifa o cliente). Una lista
// literal es lo único que se rompe cuando alguien agrega algo sin pensarlo — que es
// exactamente el caso que el centinela 14 existe para atrapar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { migrar } from "../migrar.mjs";
import { con, conectar, BD_CONTROL, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import { duenoDe } from "../provisionar.mjs";
import { versionEsperada } from "../aplicar.mjs";

/** El plano de control de E1, tabla por tabla. Agregar una acá es un acto, no un descuido. */
const TABLAS = [
  "agregados_tecnicos",
  "features",
  "grants_soporte",
  "invitaciones_tenant",
  "plan_features",
  "planes",
  "schema_migrations",
  "tenant_feature_overrides",
  "tenants",
];

/** El schema FIJO del payload del exportador (§4.1). Cero dinero, cero tarifas, cero clientes. */
const COLUMNAS_DEL_AGREGADO = [
  "backlog_sync_max_min",
  "dispositivos_activos",
  "eevd_semanal",
  "empujado_en",
  "errores_sync_pct",
  "eventos_ultima_hora",
  "id",
  "pwa_version_min",
  "tenant_id",
  "usuarios_activos",
  "ventana_fin",
  "ventana_inicio",
];

/** Lo que jamás puede aparecer en `control`: el vocabulario del negocio del tenant. */
const PALABRAS_PROHIBIDAS = /clp|monto|tarifa|precio|costo|factura|liquidacion|cliente|rut/i;

let control;

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  await migrar();
  control = await conectar(BD_CONTROL);
});

after(async () => {
  await control?.cerrar();
});

test("[AC-FTEN-04] `control` existe, es del migrador y está en la última migración de SU destino", async () => {
  assert.equal(await duenoDe(BD_CONTROL), ROL_MIGRADOR);
  const [{ version }] = await control.sql(
    "select version from schema_migrations order by version desc limit 1",
  );
  assert.equal(version, versionEsperada("control"));
});

test("[AC-FTEN-04] `control` NO tiene tablas de dominio operativo: la lista es literal", async () => {
  const tablas = (
    await control.sql(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
        "where n.nspname = 'public' and c.relkind = 'r' order by 1",
    )
  ).map((f) => f.relname);
  assert.deepEqual(tablas, TABLAS, "el plano de control cambió de forma sin que nadie lo dijera");

  // Y las tablas de dominio del tenant NO están acá, nombradas una por una: si alguna se
  // colara, la vista cross-tenant de e-auto vería datos del negocio del tenant (§4.1, §5.6).
  for (const ajena of ["eventos", "evidence", "encargos", "vehiculos", "personas", "parametros"]) {
    assert.ok(!tablas.includes(ajena), `${ajena} es de la BD del tenant y apareció en control`);
  }
});

test("[AC-FTEN-04] ninguna tabla de `control` lleva `tenant_id` como dato de dominio", async () => {
  // `tenant_id` acá es una FK al registro de tenants, no la constante de aislamiento del
  // §4.1: `control` es cross-tenant por definición y no tiene `tenant_info` contra la cual
  // verificar nada.
  const [{ existe }] = await control.sql("select to_regclass('tenant_info') is not null as existe");
  assert.equal(existe, false, "control tiene tenant_info: se estaría haciendo pasar por un tenant");
});

test("[AC-FTEN-04] CENTINELA 14: el payload del exportador cumple su schema FIJO", async () => {
  const columnas = (
    await control.sql(
      "select a.attname from pg_attribute a where a.attrelid = 'agregados_tecnicos'::regclass " +
        "and a.attnum > 0 and not a.attisdropped order by 1",
    )
  ).map((f) => f.attname);
  assert.deepEqual(
    columnas,
    COLUMNAS_DEL_AGREGADO,
    "el agregado del exportador cambió de forma: el schema es FIJO (§4.1)",
  );

  for (const col of columnas) {
    assert.doesNotMatch(
      col,
      PALABRAS_PROHIBIDAS,
      `«${col}» huele a dato comercial del tenant, y el agregado no lleva dinero, tarifas ni clientes`,
    );
  }
});

test("[AC-FTEN-04] CENTINELA 14, el rebote: inyectar una columna de dinero al agregado ⇒ rojo", async () => {
  // Se inyecta de verdad y se comprueba que la MISMA verificación de arriba se pone en rojo.
  // Sin ejercerlo, «el test de schema falla» sería una afirmación sobre código que nadie corrió.
  const migrador = await conectar(BD_CONTROL, { usuario: ROL_MIGRADOR });
  try {
    await migrador.sql("alter table agregados_tecnicos add column ingresos_mes_clp bigint");
    const columnas = (
      await control.sql(
        "select a.attname from pg_attribute a where a.attrelid = 'agregados_tecnicos'::regclass " +
          "and a.attnum > 0 and not a.attisdropped order by 1",
      )
    ).map((f) => f.attname);

    assert.notDeepEqual(columnas, COLUMNAS_DEL_AGREGADO, "la lista literal no notó la columna nueva");
    assert.ok(
      columnas.some((c) => PALABRAS_PROHIBIDAS.test(c)),
      "el guard de vocabulario no vio una columna de dinero",
    );
  } finally {
    await migrador.sql("alter table agregados_tecnicos drop column if exists ingresos_mes_clp");
    await migrador.cerrar();
  }

  // Y el cluster vuelve a estar sano: el rojo era por la inyección y no quedó nada roto.
  const columnas = (
    await control.sql(
      "select a.attname from pg_attribute a where a.attrelid = 'agregados_tecnicos'::regclass " +
        "and a.attnum > 0 and not a.attisdropped order by 1",
    )
  ).map((f) => f.attname);
  assert.deepEqual(columnas, COLUMNAS_DEL_AGREGADO);
});

test("[AC-FTEN-04] el registro de tenants no deja que la BD y el slug diverjan", async () => {
  const [plan] = await control.sql(
    "insert into planes (lookup_key, nombre, limite_vehiculos) values ('gate_partida', 'Partida', 1) " +
      "on conflict (lookup_key) do update set nombre = excluded.nombre returning id::text as id",
  );
  await control.sql("delete from tenants where slug like 'gate_%'");

  await control.sql(
    "insert into tenants (slug, bd, plan_id) values ($1, $2, $3)",
    ["gate_ctrl", bdDeTenant("gate_ctrl"), plan.id],
  );

  // Un tenant apuntando a la base de otro sería el cruce que el §4.1 hace imposible por
  // construcción, deshecho en una fila de esta tabla.
  await assert.rejects(
    () => control.sql("insert into tenants (slug, bd) values ('gate_otro', 't_gate_ctrl')"),
    { code: "23514" },
  );
  await assert.rejects(
    () => control.sql("insert into tenants (slug, bd) values ('Gate-Malo', 't_Gate-Malo')"),
    { code: "23514" },
  );

  await control.sql("delete from tenants where slug like 'gate_%'");
});

test("[AC-FTEN-04] un override de feature sin motivo escrito no entra", async () => {
  // Una excepción sin razón escrita es una excepción sin dueño: a los seis meses nadie sabe
  // si todavía corresponde (§10).
  const [feature] = await control.sql(
    "insert into features (lookup_key, module) values ('gate.feature', '00') " +
      "on conflict (lookup_key) do update set module = excluded.module returning id::text as id",
  );
  const [tenant] = await control.sql(
    "insert into tenants (slug, bd) values ('gate_ovr', 't_gate_ovr') returning id::text as id",
  );
  try {
    await assert.rejects(
      () =>
        control.sql(
          "insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo) " +
            "values ($1, $2, true, '   ')",
          [tenant.id, feature.id],
        ),
      { code: "23514" },
    );
    await control.sql(
      "insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo) " +
        "values ($1, $2, true, 'piloto acordado con el cliente')",
      [tenant.id, feature.id],
    );
  } finally {
    await control.sql("delete from tenant_feature_overrides where tenant_id = $1", [tenant.id]);
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-04] un grant de soporte sin vencimiento no entra", async () => {
  const [tenant] = await control.sql(
    "insert into tenants (slug, bd) values ('gate_sop', 't_gate_sop') returning id::text as id",
  );
  try {
    await assert.rejects(
      () =>
        control.sql(
          "insert into grants_soporte (tenant_id, otorgado_a, motivo, otorgado_en, expira_en) " +
            "values ($1, 'soporte@e-auto.global', 'incidente 123', now(), now() - interval '1 hour')",
          [tenant.id],
        ),
      { code: "23514" },
      "un grant que ya nació vencido, o sin ventana, es un acceso permanente con otro nombre",
    );
  } finally {
    await control.sql("delete from grants_soporte where tenant_id = $1", [tenant.id]);
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});
