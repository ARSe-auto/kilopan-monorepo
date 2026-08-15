#!/usr/bin/env node
// Centinela 11 COMPLETO: mi_flota→daas→mi_flota no pierde una fila [AC-FPOR-02].
//
// `db/flota/suite-bd/control.test.mjs` (AC-FTEN-22) ya prueba la mitad barata: que el PLANO
// DE CONTROL no pierde filas al conmutar, comparando counts sobre tablas de catálogo vacías
// de operación real. Lo que falta —y lo que el TEXTO de este AC pide explícitamente
// («comparación por PK, counts ≥», «empresa implícita intacta»)— es la mitad cara: un tenant
// de VERDAD, con datos operativos de VERDAD en SU PROPIA base, conmutado con el SERVICIO real
// (`conmutarModo`, el mismo que va a llamar el panel admin del hito 08) y verificado fila por
// fila, tabla por tabla, no tabla por tabla nada más.
//
// El oráculo es de NO-PÉRDIDA y NUNCA de igualdad de counts: cada conmutación appendea filas
// legítimas (`eventos` gana una fila de auditoría por vuelta, §5.5). Por eso la comparación es
// por PK —toda fila del snapshot previo sigue estando, sin importar el orden ni las filas
// nuevas— y el count exige SOLO `≥`, jamás `=`.
//
// El barrido de tablas es DINÁMICO (`pg_class`/`pg_constraint`), no una lista a mano: si mañana
// nace `manifiestos` o `liquidaciones` con datos, el centinela las cubre sin que nadie tenga
// que acordarse de agregarlas acá — que es exactamente el tipo de olvido que este AC existe
// para no depender de.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { migrar } from "../migrar.mjs";
import { con, conectar, BD_CONTROL, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { conmutarModo } from "../../../apps/flota/src/servidor/modo.ts";
import { poolDe } from "../../../apps/flota/src/servidor/conexion.ts";

const SLUG = "gate_centinela11";

let control;
let tenant;
let migrador;

let snapshotAntes;
let snapshotDespues;
let implicitaAntes;
let implicitaDespues;

async function limpiar() {
  await control?.sql("delete from tenants where slug = $1", [SLUG]);
  await con("postgres", ({ sql }) =>
    sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`),
  );
  await borrarRolDeApp(SLUG);
}

/** Toda tabla base del schema del tenant, salvo la contabilidad del runner (§ nota de
 *  `0001_identidad_del_tenant.sql`: "schema_migrations… no una tabla de dominio"). */
async function tablasDeDominio(sql) {
  const filas = await sql(
    `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'
      order by 1`,
  );
  return filas.map((f) => f.relname);
}

/** Las columnas de la PK de `tabla`, en orden. Vacío si la tabla no tiene una declarada. */
async function pkColumnas(sql, tabla) {
  const filas = await sql(
    `select a.attname
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join unnest(con.conkey) with ordinality as k(attnum, ord) on true
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where con.contype = 'p' and c.relnamespace = 'public'::regnamespace and c.relname = $1
      order by k.ord`,
    [tabla],
  );
  return filas.map((f) => f.attname);
}

/**
 * Snapshot de UNA tabla: cuántas filas tiene y, si declara PK, el conjunto de sus valores (uno
 * por fila, columnas compuestas concatenadas). Sin PK solo queda el count — no hay identidad de
 * fila que comparar, pero el `≥` del AC sigue rigiendo igual.
 */
async function snapshotDeTabla(sql, tabla) {
  const pk = await pkColumnas(sql, tabla);
  if (pk.length === 0) {
    const [{ n }] = await sql(`select count(*)::int as n from ${tabla}`);
    return { count: n, pks: null };
  }
  const expr = pk.map((c) => `${c}::text`).join(" || '\\u0001' || ");
  const filas = await sql(`select ${expr} as pk from ${tabla}`);
  return { count: filas.length, pks: new Set(filas.map((f) => f.pk)) };
}

async function snapshotTodo(sql) {
  const mapa = new Map();
  for (const tabla of await tablasDeDominio(sql)) {
    mapa.set(tabla, await snapshotDeTabla(sql, tabla));
  }
  return mapa;
}

/** Datos operativos reales, a través de varios módulos: identidad, encargos, ruteo. No hace
 *  falta sembrar CADA tabla del sistema — el barrido de `snapshotTodo` cubre las que queden en
 *  cero filas igual de bien (el conjunto vacío es subconjunto de cualquier cosa). */
async function sembrarOperacion() {
  const una = async (texto, params = []) => (await migrador.sql(texto, params))[0];

  // Los RUTs son de la lista congelada de `db/flota/ruts-sinteticos.mjs` [AC-FIDN-21]: esta
  // suite corre en su propio tenant (`gate_centinela11`), así que reusar los de otra suite no
  // choca — cada tenant es su propia base (§4.1).
  const contratante = await una(
    "insert into empresas_cliente (rut, razon_social) values " +
      "('77.222.222-K', 'Contratante centinela 11') returning id::text as id",
  );
  const destino = await una(
    "insert into destinos (nombre) values ('Bodega centinela 11') returning id::text as id",
  );
  const persona = await una(
    "insert into personas (rut, nombre) values ('5.126.663-3', 'Chofer centinela') " +
      "returning id::text as id",
  );
  await migrador.sql("insert into usuarios (persona_id, rol) values ($1, 'chofer')", [persona.id]);
  await migrador.sql(
    "insert into vehiculos (patente, tipo) values ('CNT0011', 'furgón') returning id::text as id",
  );
  const ruta = await una(
    "insert into rutas (nombre) values ('Ruta centinela 11') returning id::text as id",
  );
  const parada = await una(
    "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) " +
      "returning id::text as id",
    [ruta.id, destino.id],
  );
  const encargo = await una(
    "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 5) " +
      "returning id::text as id",
    [contratante.id, destino.id],
  );
  await migrador.sql(
    "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 1)",
    [parada.id, encargo.id],
  );
}

async function empresaImplicita() {
  const [fila] = await migrador.sql(
    "select id::text as id, rut, razon_social, implicita from empresas_cliente where implicita",
  );
  return fila ?? null;
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
  await migrar();
  control = await conectar(BD_CONTROL);
  await limpiar();

  tenant = await provisionar(SLUG, { recrear: true });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });

  // `control` es la AUTORIDAD del modo (modo.ts): el alta real la hace `altaTenant`/el wizard
  // del hito 08, acá se inserta directo porque lo que se prueba es la CONMUTACIÓN, no el alta
  // (eso ya lo prueba AC-FPOR-01).
  await control.sql("insert into tenants (slug, bd, modo) values ($1, $2, 'mi_flota')", [
    SLUG,
    tenant.bd,
  ]);

  // La empresa implícita nace del trigger de `0039_empresa_implicita.sql` cuando `tenant_info`
  // tiene RUT y razón social propios (§4.5) — la provisión de test no los siembra porque en
  // producción los llena el wizard.
  await migrador.sql("update tenant_info set rut_de_la_empresa = $1, razon_social = $2", [
    "76.111.111-6",
    "Mi Flota Implícita SPA",
  ]);

  await sembrarOperacion();

  snapshotAntes = await snapshotTodo(migrador.sql);
  implicitaAntes = await empresaImplicita();
  assert.ok(implicitaAntes, "el fixture no logró crear la empresa implícita: nada que centinelar");

  const acto = {
    pool: poolDe(tenant.bd),
    sesion: {
      dispositivoId: crypto.randomUUID(),
      usuarioId: crypto.randomUUID(),
      rol: "admin_tenant",
      empresaClienteId: null,
    },
    slug: SLUG,
  };

  const aDaas = await conmutarModo(acto, "daas");
  assert.equal(aDaas.tipo, "ok", "la conmutación a daas rebotó: el centinela no se pudo ejercer");
  const aMiFlota = await conmutarModo(acto, "mi_flota");
  assert.equal(aMiFlota.tipo, "ok", "la conmutación de vuelta a mi_flota rebotó");

  snapshotDespues = await snapshotTodo(migrador.sql);
  implicitaDespues = await empresaImplicita();
});

after(async () => {
  await migrador?.cerrar();
  // El pool de `poolDe` (conexion.ts) queda memorizado en `globalThis` con conexiones vivas
  // contra `tenant.bd`: si no se cierra ANTES del `drop database … with (force)` de `limpiar`,
  // Postgres las mata a la fuerza y el pool de `pg` reporta el corte como una excepción no
  // atrapada DESPUÉS de que el test ya terminó.
  if (tenant) await poolDe(tenant.bd).end();
  await limpiar();
  await control?.cerrar();
});

test("[AC-FPOR-02] CENTINELA 11: toda tabla de dominio conserva, por PK, cada fila que tenía antes de conmutar", async () => {
  assert.ok(snapshotAntes.size > 0, "el barrido no encontró ninguna tabla de dominio");
  for (const [tabla, antes] of snapshotAntes) {
    const despues = snapshotDespues.get(tabla);
    assert.ok(despues, `${tabla} desapareció de la base después de conmutar`);
    if (antes.pks) {
      for (const pk of antes.pks) {
        assert.ok(
          despues.pks.has(pk),
          `${tabla}: una fila (PK ${pk}) presente ANTES de conmutar no está DESPUÉS`,
        );
      }
    }
  }
});

test("[AC-FPOR-02] CENTINELA 11: el count de cada tabla de dominio nunca BAJA (≥, jamás =)", async () => {
  for (const [tabla, antes] of snapshotAntes) {
    const despues = snapshotDespues.get(tabla);
    assert.ok(
      despues.count >= antes.count,
      `${tabla}: el count bajó de ${antes.count} a ${despues.count} al conmutar ida y vuelta`,
    );
  }
  // Y el AC no es «igualdad disfrazada»: al menos una tabla SÍ crece (eventos, con la
  // auditoría de las dos conmutaciones) — si nada creciera, la prueba de arriba pasaría
  // también con una implementación que hiciera `=` en vez de `≥` sin que nadie lo notara.
  const eventosAntes = snapshotAntes.get("eventos");
  const eventosDespues = snapshotDespues.get("eventos");
  assert.ok(
    eventosDespues.count > eventosAntes.count,
    "eventos no creció: la doble conmutación no dejó rastro de auditoría (§5.5)",
  );
});

test("[AC-FPOR-02] la empresa implícita queda intacta: mismo id, misma fila, ni una segunda", async () => {
  assert.ok(implicitaDespues, "la empresa implícita desapareció al volver a mi_flota");
  assert.deepEqual(
    implicitaDespues,
    implicitaAntes,
    "la empresa implícita cambió de id o de datos al conmutar ida y vuelta",
  );

  const todasLasImplicitas = await migrador.sql(
    "select id::text as id from empresas_cliente where implicita",
  );
  assert.equal(
    todasLasImplicitas.length,
    1,
    "volver a mi_flota creó una SEGUNDA empresa implícita: el trigger dejó de ser idempotente",
  );
});
