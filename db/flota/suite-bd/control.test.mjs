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
import { desregistrarComo } from "./desregistrar.mjs";
import { duenoDe } from "../provisionar.mjs";
import { versionEsperada } from "../aplicar.mjs";
import { altaTenant } from "../../../apps/flota/src/servidor/modo.ts";

/** El plano de control de E1, tabla por tabla. Agregar una acá es un acto, no un descuido. */
const TABLAS = [
  "agregados_tecnicos",
  // El registro de accesos de emergencia (AC-FIDN-18). Vive en `control` y no en el tenant
  // porque lo abre la PLATAFORMA con doble control propio, justamente cuando el dueño no está
  // disponible; lo que el tenant SÍ ve es el aviso forzoso en su bandeja.
  "break_glass",
  "features",
  "grants_soporte",
  "invitaciones_tenant",
  "modo_recorte",
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
  // Acotado a SU propio slug, no a 'gate_%' entero: desde que `provisionar()` también da de
  // alta en `control.tenants` [AC-FPOR-01], ese comodín se llevaría por delante tenants vivos
  // de OTRAS suites (p. ej. `gate_a`/`gate_b`, que el gate deja registrados a propósito) y el
  // DELETE rebotaría contra `agregados_tecnicos_tenant_id_fkey` en vez de limpiar lo suyo.
  await control.sql("delete from tenants where slug = 'gate_ctrl'");

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

  await control.sql("delete from tenants where slug = 'gate_ctrl'");
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

// --- Resolución de entitlements ------------------------------------------------- [AC-FTEN-11]
// La fórmula del §4.4 es LITERAL —`efectivo = override ?? plan`— y se prueba en AMBOS
// sentidos, porque una implementación que solo mire el plan pasa la mitad de los casos.

/** Arma un tenant con un plan que trae `enElPlan` y no trae `fueraDelPlan`. */
async function escenarioDeEntitlements() {
  await desregistrarComo("gate\\_ent%");
  const [plan] = await control.sql(
    "insert into planes (lookup_key, nombre) values ('gate_ent_plan', 'Gate') " +
      "on conflict (lookup_key) do update set nombre = excluded.nombre returning id::text as id",
  );
  const feats = {};
  for (const key of ["gate.en_el_plan", "gate.fuera_del_plan"]) {
    const [f] = await control.sql(
      "insert into features (lookup_key, module) values ($1, '00') " +
        "on conflict (lookup_key) do update set module = excluded.module returning id::text as id",
      [key],
    );
    feats[key] = f.id;
  }
  await control.sql("delete from plan_features where plan_id = $1", [plan.id]);
  await control.sql("insert into plan_features (plan_id, feature_id) values ($1, $2)", [
    plan.id,
    feats["gate.en_el_plan"],
  ]);
  const [tenant] = await control.sql(
    "insert into tenants (slug, bd, plan_id) values ('gate_ent', 't_gate_ent', $1) returning id::text as id",
    [plan.id],
  );
  return { plan, feats, tenant };
}

const efectivo = async (tenantId, key) =>
  (await control.sql("select entitlement_efectivo($1, $2) as e", [tenantId, key]))[0].e;

test("[AC-FTEN-11] sin override, el efectivo ES el plan", async () => {
  const { tenant } = await escenarioDeEntitlements();
  try {
    assert.equal(await efectivo(tenant.id, "gate.en_el_plan"), true);
    assert.equal(await efectivo(tenant.id, "gate.fuera_del_plan"), false);
    assert.equal(await efectivo(tenant.id, "gate.inexistente"), false, "una feature que no existe no está encendida");
  } finally {
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-11] override OFF sobre una feature DEL plan ⇒ OFF", async () => {
  const { feats, tenant } = await escenarioDeEntitlements();
  try {
    await control.sql(
      "insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo) " +
        "values ($1, $2, false, 'apagada a pedido del cliente')",
      [tenant.id, feats["gate.en_el_plan"]],
    );
    assert.equal(await efectivo(tenant.id, "gate.en_el_plan"), false);
  } finally {
    await control.sql("delete from tenant_feature_overrides where tenant_id = $1", [tenant.id]);
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-11] override ON sobre una feature FUERA del plan ⇒ ON: la fórmula es literal", async () => {
  // El guard comercial que impide encender fuera de plan es de la pantalla «Funciones» del
  // hito g (§5.5), no de la resolución. Mezclarlos haría imposible el piloto acordado con un
  // cliente — que es justo por lo que el motivo del override es obligatorio.
  const { feats, tenant } = await escenarioDeEntitlements();
  try {
    await control.sql(
      "insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo) " +
        "values ($1, $2, true, 'piloto acordado, vence en marzo')",
      [tenant.id, feats["gate.fuera_del_plan"]],
    );
    assert.equal(await efectivo(tenant.id, "gate.fuera_del_plan"), true);
  } finally {
    await control.sql("delete from tenant_feature_overrides where tenant_id = $1", [tenant.id]);
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-11] la vista y la función dicen SIEMPRE lo mismo, y la vista dice de dónde sale", async () => {
  // Dos fuentes de verdad para la misma fórmula es la forma más cara de tener un bug: la
  // prueba compara las dos sobre cada feature del tenant, no sobre una elegida a mano.
  const { feats, tenant } = await escenarioDeEntitlements();
  try {
    await control.sql(
      "insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo) " +
        "values ($1, $2, true, 'piloto acordado, vence en marzo')",
      [tenant.id, feats["gate.fuera_del_plan"]],
    );
    const filas = await control.sql(
      "select lookup_key, habilitada, por_override, motivo, " +
        "entitlement_efectivo($1, lookup_key) as por_funcion " +
        "from entitlements_efectivos where tenant_id = $1 order by lookup_key",
      [tenant.id],
    );
    assert.ok(filas.length >= 2, "la vista no ejercitó ninguna feature");
    for (const f of filas) {
      assert.equal(f.habilitada, f.por_funcion, `la vista y la función discrepan en ${f.lookup_key}`);
    }
    const fuera = filas.find((f) => f.lookup_key === "gate.fuera_del_plan");
    assert.equal(fuera.por_override, true, "la vista no dice que vino de un override");
    assert.match(fuera.motivo, /piloto/, "la vista no trae el motivo del override");
  } finally {
    await control.sql("delete from tenant_feature_overrides where tenant_id = $1", [tenant.id]);
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-11] los límites cuantitativos son COLUMNAS del plan, no features", async () => {
  // Un límite es un número, no un interruptor (§4.4). Si viviera como feature, «1 vehículo»
  // y «300 entregas/mes» del plan Partida serían dos booleanos que no dicen cuánto.
  const columnas = (
    await control.sql(
      "select a.attname from pg_attribute a where a.attrelid = 'planes'::regclass " +
        "and a.attnum > 0 and not a.attisdropped",
    )
  ).map((f) => f.attname);
  assert.ok(columnas.includes("limite_vehiculos"));
  assert.ok(columnas.includes("limite_entregas_mes"));
});

// --- El modo como preset de entitlements ---------------------------------------- [AC-FTEN-22]
// El §3 es explícito: los modos NO son código distinto. Por eso lo que se prueba acá es que el
// recorte vive en la RESOLUCIÓN y no en filas borradas — y que conmutar dos veces no pierde
// nada, que es la base del centinela 11.

/** Las cuatro cosas del contratante que `mi_flota` apaga, según el mapeo cerrado del §3. */
const RECORTE_MI_FLOTA = ["tarifas", "liquidacion_por_cliente", "portal_contratante", "facturacion"];

async function tenantConTodoEnElPlan() {
  await desregistrarComo("gate\\_modo%");
  const [plan] = await control.sql(
    "insert into planes (lookup_key, nombre) values ('gate_modo_plan', 'Completo') " +
      "on conflict (lookup_key) do update set nombre = excluded.nombre returning id::text as id",
  );
  await control.sql("delete from plan_features where plan_id = $1", [plan.id]);
  for (const key of [...RECORTE_MI_FLOTA, "operativo_puro"]) {
    const [f] = await control.sql(
      "insert into features (lookup_key, module) values ($1, '00') " +
        "on conflict (lookup_key) do update set module = excluded.module returning id::text as id",
      [key],
    );
    await control.sql("insert into plan_features (plan_id, feature_id) values ($1, $2)", [
      plan.id,
      f.id,
    ]);
  }
  const [tenant] = await control.sql(
    "insert into tenants (slug, bd, plan_id, modo) values ('gate_modo', 't_gate_modo', $1, 'daas') " +
      "returning id::text as id",
    [plan.id],
  );
  return tenant;
}

test("[AC-FTEN-22] con `daas` no hay recorte: el plan resuelve tal cual", async () => {
  const tenant = await tenantConTodoEnElPlan();
  try {
    for (const key of [...RECORTE_MI_FLOTA, "operativo_puro"]) {
      assert.equal(await efectivo(tenant.id, key), true, `${key} debería estar encendida en daas`);
    }
  } finally {
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-22] con `mi_flota` las CUATRO del contratante resuelven OFF y lo operativo queda", async () => {
  const tenant = await tenantConTodoEnElPlan();
  try {
    await control.sql("update tenants set modo = 'mi_flota' where id = $1", [tenant.id]);
    for (const key of RECORTE_MI_FLOTA) {
      assert.equal(await efectivo(tenant.id, key), false, `${key} quedó encendida en mi_flota`);
    }
    assert.equal(
      await efectivo(tenant.id, "operativo_puro"),
      true,
      "el recorte se llevó puesto lo operativo, y mi_flota es «lo operativo puro»",
    );
  } finally {
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-22] el recorte del modo gana sobre un override ON: «OFF y ocultos» no tiene matices", async () => {
  // Si un override pudiera encender tarifas en un tenant `mi_flota`, el modo dejaría de
  // significar algo y la pantalla del contratante aparecería a medias. Encenderlas se hace
  // conmutando el modo — y como el recorte no borra nada, conmutar las devuelve intactas.
  const tenant = await tenantConTodoEnElPlan();
  try {
    const [f] = await control.sql("select id::text as id from features where lookup_key = 'tarifas'");
    await control.sql(
      "insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo) " +
        "values ($1, $2, true, 'intento de encender tarifas en mi_flota')",
      [tenant.id, f.id],
    );
    await control.sql("update tenants set modo = 'mi_flota' where id = $1", [tenant.id]);
    assert.equal(await efectivo(tenant.id, "tarifas"), false);

    // Y al conmutar a daas el override sigue ahí y vuelve a mandar: no se borró nada.
    await control.sql("update tenants set modo = 'daas' where id = $1", [tenant.id]);
    assert.equal(await efectivo(tenant.id, "tarifas"), true);
  } finally {
    await control.sql("delete from tenant_feature_overrides where tenant_id = $1", [tenant.id]);
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

test("[AC-FTEN-22] CENTINELA 11 (base): mi_flota→daas→mi_flota no pierde una sola fila", async () => {
  const tenant = await tenantConTodoEnElPlan();
  const conteos = async () => {
    const [f] = await control.sql(
      `select
         (select count(*)::int from plan_features)            as plan_features,
         (select count(*)::int from tenant_feature_overrides) as overrides,
         (select count(*)::int from features)                 as features,
         (select count(*)::int from modo_recorte)             as recortes,
         (select count(*)::int from tenants)                  as tenants`,
    );
    return f;
  };
  const efectivos = async () =>
    control.sql(
      "select lookup_key, habilitada from entitlements_efectivos where tenant_id = $1 order by lookup_key",
      [tenant.id],
    );

  try {
    await control.sql("update tenants set modo = 'mi_flota' where id = $1", [tenant.id]);
    const antes = await conteos();
    const resueltoAntes = await efectivos();
    assert.ok(resueltoAntes.length > 0, "la vista no resolvió ninguna feature");

    await control.sql("update tenants set modo = 'daas' where id = $1", [tenant.id]);
    await control.sql("update tenants set modo = 'mi_flota' where id = $1", [tenant.id]);

    assert.deepEqual(await conteos(), antes, "conmutar el modo borró filas");
    assert.deepEqual(await efectivos(), resueltoAntes, "conmutar ida y vuelta no dejó todo igual");
  } finally {
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

// --- Selector persistido: dominio y alta ---------------------------------------- [AC-FPOR-01]
// El botón del wizard que arma slug/bd/plan es GUI del módulo 08 (AC-FMIG-14, sin construir
// todavía); lo que este AC prueba es el servicio de alta que ese botón va a llamar —
// `altaTenant`— y que el dominio de `modo` está cerrado en las DOS puertas por las que se
// puede colar un valor: el servicio (antes de tocar la base) y la columna misma (para
// cualquier otro caller que la toque directo, como un fixture).

test("[AC-FPOR-01] `altaTenant` rebota un modo fuera de dominio, sin tocar la base", async () => {
  await control.sql("delete from tenants where slug like 'gate_fpor%'");
  const antes = (await control.sql("select count(*)::int as n from tenants where slug like 'gate_fpor%'"))[0].n;

  const resultado = await altaTenant({
    slug: "gate_fpor_malo",
    bd: bdDeTenant("gate_fpor_malo"),
    modo: "franquicia",
  });
  assert.deepEqual(resultado, { tipo: "modo_desconocido" });

  const despues = (await control.sql("select count(*)::int as n from tenants where slug like 'gate_fpor%'"))[0].n;
  assert.equal(despues, antes, "el rebote del servicio dejó una fila puesta");
});

test("[AC-FPOR-01] la columna `control.tenants.modo` rebota el mismo valor fuera de dominio (CHECK de tipo)", async () => {
  // El servicio de arriba es una puerta; esta es la otra. Si algo la esquivara —un fixture, una
  // migración de datos— el dominio sigue cerrado porque `modo` es un enum, no un `text` con
  // convención: un valor que no está en `tenant_modo` no es una fila inválida, es SQL que no
  // corre.
  await control.sql("delete from tenants where slug = 'gate_fpor_sql'");
  await assert.rejects(
    () =>
      control.sql("insert into tenants (slug, bd, modo) values ($1, $2, 'franquicia')", [
        "gate_fpor_sql",
        bdDeTenant("gate_fpor_sql"),
      ]),
    { code: "22P02" },
  );
  const [{ n }] = await control.sql("select count(*)::int as n from tenants where slug = 'gate_fpor_sql'");
  assert.equal(n, 0, "el INSERT rebotado dejó una fila puesta");
});

test("[AC-FPOR-01] el alta persiste el modo elegido, no el default", async () => {
  await control.sql("delete from tenants where slug = 'gate_fpor_daas'");
  try {
    const resultado = await altaTenant({
      slug: "gate_fpor_daas",
      bd: bdDeTenant("gate_fpor_daas"),
      modo: "daas",
    });
    assert.equal(resultado.tipo, "ok");
    assert.equal(resultado.modo, "daas");

    const [fila] = await control.sql("select modo::text as modo from tenants where id = $1", [
      resultado.tenantId,
    ]);
    // `mi_flota` es el DEFAULT de la columna (§4.4): si el alta lo ignorara y la fila naciera
    // con el default en vez del valor elegido, esta aserción no lo notaría con otro modo que no
    // fuera precisamente el que NO es el default.
    assert.equal(fila.modo, "daas", "el alta no persistió el modo elegido en el wizard");
  } finally {
    await control.sql("delete from tenants where slug = 'gate_fpor_daas'");
  }
});

test("[AC-FPOR-01] el alta también persiste `mi_flota` cuando es el modo elegido explícitamente", async () => {
  await control.sql("delete from tenants where slug = 'gate_fpor_mi_flota'");
  try {
    const resultado = await altaTenant({
      slug: "gate_fpor_mi_flota",
      bd: bdDeTenant("gate_fpor_mi_flota"),
      modo: "mi_flota",
    });
    assert.equal(resultado.tipo, "ok");
    const [fila] = await control.sql("select modo::text as modo from tenants where id = $1", [
      resultado.tenantId,
    ]);
    assert.equal(fila.modo, "mi_flota");
  } finally {
    await control.sql("delete from tenants where slug = 'gate_fpor_mi_flota'");
  }
});

test("[AC-FTEN-22] el mapeo del §3 es CERRADO y vive como filas, no como un condicional", async () => {
  const filas = (
    await control.sql("select feature_lookup_key from modo_recorte where modo = 'mi_flota' order by 1")
  ).map((f) => f.feature_lookup_key);
  assert.deepEqual(filas, [...RECORTE_MI_FLOTA].sort());

  const [{ n }] = await control.sql("select count(*)::int as n from modo_recorte where modo = 'daas'");
  assert.equal(n, 0, "daas no recorta nada: la ausencia de filas ES el mapeo");
});

test("[AC-FTEN-22] la vista dice CUÁL apagó el modo, para que la UI no tenga que adivinarlo", async () => {
  const tenant = await tenantConTodoEnElPlan();
  try {
    await control.sql("update tenants set modo = 'mi_flota' where id = $1", [tenant.id]);
    const filas = await control.sql(
      "select lookup_key, habilitada, recortada_por_modo from entitlements_efectivos " +
        "where tenant_id = $1 and lookup_key = any($2)",
      [tenant.id, RECORTE_MI_FLOTA],
    );
    assert.equal(filas.length, RECORTE_MI_FLOTA.length);
    for (const f of filas) {
      assert.equal(f.recortada_por_modo, true, `${f.lookup_key} no dice que la apagó el modo`);
      assert.equal(f.habilitada, false);
    }
  } finally {
    await control.sql("delete from tenants where id = $1", [tenant.id]);
  }
});

// --- El mapeo del modo apunta a features que EXISTEN ------------------------ [AC-FTAR-18]
//
// `modo_recorte` (0003) nombra por `lookup_key` de TEXTO las features que cada modo apaga, sin
// FK contra `features`: es el mismo plano de control, pero el recorte se resuelve por nombre.
// Eso significa que un nombre mal escrito —o, como pasó de verdad hasta la 0009, un catálogo
// donde esas filas nunca se sembraron— no rebota en ninguna parte. La resolución simplemente
// no encuentra la feature, el snapshot congelado no la incluye para NINGÚN modo y el manifest
// la omite siempre: `daas` termina viéndose igual que `mi_flota`, que es exactamente la
// contracción que el §3 dice que NO debe pasar.
//
// El invariante que lo atrapa no es «existen estas cuatro» sino la relación entera: toda
// lookup_key que el mapeo recorta tiene que estar en el catálogo. Así también cubre el modo
// que alguien agregue mañana.

test("[AC-FTAR-18] toda feature que un modo recorta existe en el catálogo", async () => {
  const huerfanas = await control.sql(
    "select r.modo::text as modo, r.feature_lookup_key as key from modo_recorte r " +
      "where not exists (select 1 from features f where f.lookup_key = r.feature_lookup_key) " +
      "order by 1, 2",
  );
  assert.deepEqual(
    huerfanas,
    [],
    "modo_recorte apunta a features que no están en el catálogo: la resolución las ignora en " +
      "silencio y la contracción por modo deja de existir sin que nada se ponga rojo",
  );

  // Y el mapeo no está vacío: sin esto, la prueba de arriba sería verde vacuo el día que
  // alguien borre las filas de `modo_recorte` en vez de arreglar el catálogo.
  const [{ n }] = await control.sql("select count(*)::int as n from modo_recorte");
  assert.ok(n > 0, "modo_recorte quedó vacío: no habría recorte que verificar");
});

test("[AC-FTAR-18] el grupo DaaS del §3 está completo en el catálogo, con sus cuatro miembros", async () => {
  // La lista literal del §3, no un conteo: si mañana alguien agrega una quinta cosa al grupo
  // sin sembrarla, el `deepEqual` de arriba no la vería —no estaría en modo_recorte— pero esta
  // sí, porque el §3 cierra el grupo en cuatro.
  const filas = await control.sql(
    "select lookup_key from features where lookup_key in " +
      "('tarifas', 'liquidacion_por_cliente', 'portal_contratante', 'facturacion') order by 1",
  );
  assert.deepEqual(
    filas.map((f) => f.lookup_key),
    ["facturacion", "liquidacion_por_cliente", "portal_contratante", "tarifas"],
    "falta alguna de las cuatro del grupo DaaS (§3) en el catálogo de features",
  );
});
