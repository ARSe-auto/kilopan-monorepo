#!/usr/bin/env node
// Offboarding contra el cluster real [AC-FTEN-17].
//
// La prueba no es «el pg_dump no falló»: es que la base restaurada, en otro lugar y sin
// nuestros roles, tenga los MISMOS conteos que la original y siga siendo coherente. Eso es lo
// que la Ley 21.719 le promete al tenant y lo que la métrica 7 del §2 mide.
//
// Y de paso ejerce la decisión de diseño más delicada del módulo: `tenant_actual()` con el
// uuid HORNEADO como literal. Un CHECK que leyera `tenant_info` fallaría en cada fila del
// COPY, porque `pg_restore` crea las funciones ANTES de que lleguen los datos. Acá se
// comprueba que no fallan.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { volcarTenant, restaurarEn, volcadoIncluye } from "../offboarding.mjs";
import { migrar } from "../migrar.mjs";
import { provisionar, desalta } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_offb";
const RESTAURADA = "t_gate_offb_restaurada";
/** Las tablas cuyos conteos se comparan. Vacía sería un verde vacuo, así que se siembran. */
const CONTADAS = ["tenant_info", "evento_tipo", "eventos", "evidence", "client_metric", "review_queue"];

let tenant;
let original;
let carpeta;
let volcado;

async function limpiar() {
  // Complemento del alta en `control.tenants` [AC-FPOR-01]: sin esto, la fila sobrevive al
  // DROP DATABASE y el job exportador la reporta huérfana en la corrida siguiente.
  await desalta(SLUG);
  await con("postgres", async ({ sql }) => {
    await sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`);
    await sql(`drop database if exists ${RESTAURADA} with (force)`);
  });
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
  await migrar();
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  original = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });

  // Datos de verdad en varias tablas: sin filas, comparar conteos sería comparar ceros.
  const [tipo] = await original.sql(
    "insert into evento_tipo (codigo, descripcion) values ('gate.offb', 'fixture') returning id::text as id",
  );
  await original.sql(
    `insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min)
     select $1, 'gate', uuidv7(), now(), -240 from generate_series(1, 7)`,
    [tipo.id],
  );
  await original.sql(
    `insert into evidence (tipo, objeto_tabla, objeto_id, valor, capturada_en, tz_offset_min)
     select 'pin_destinatario', 'gate', uuidv7(), '1234', now(), -240 from generate_series(1, 3)`,
  );
  await original.sql(
    `insert into client_metric (tipo, valor_int, ts, tz_offset_min, client_uuid)
     select 'toques_flujo', 4, now(), -240, uuidv7() from generate_series(1, 5)`,
  );
  await original.sql("insert into review_queue (origen, severidad) values ('gate', 'baja')");
  await original.sql("insert into parametros (tarifa_kwh_clp) values (190)");
  await original.sql("insert into vertical_template (vertical, meta_eevd) values ('panaderia', 18)");

  carpeta = mkdtempSync(join(tmpdir(), "flota-offb-"));
  volcado = volcarTenant(SLUG, { destino: join(carpeta, "entrega.sql") });
});

after(async () => {
  await original?.cerrar();
  if (carpeta) rmSync(carpeta, { recursive: true, force: true });
  await limpiar();
});

test("[AC-FTEN-17] el volcado es la base ENTERA y no un archivo simbólico", async () => {
  assert.ok(volcado.bytes > 1000, `el volcado pesa ${volcado.bytes} bytes`);
  // El esquema, los datos y las funciones. `tenant_actual()` sobre todo: es lo que hace que
  // los CHECK sigan siendo verdad del otro lado.
  assert.ok(volcadoIncluye(volcado.archivo, /CREATE TABLE public\.eventos/i), "sin el esquema");
  assert.ok(volcadoIncluye(volcado.archivo, /COPY public\.eventos/i), "sin los datos");
  assert.ok(volcadoIncluye(volcado.archivo, /FUNCTION public\.tenant_actual/i), "sin la constante");
  assert.ok(volcadoIncluye(volcado.archivo, new RegExp(tenant.id)), "sin el uuid del tenant");
});

test("[AC-FTEN-17] el volcado no lleva NUESTROS roles: se restaura con los de quien lo reciba", async () => {
  // Un archivo que exige un rol `migrator` o un `app_t_<slug>` para abrirse es un archivo que
  // solo nosotros podemos abrir, o sea lo contrario de portabilidad.
  assert.ok(!volcadoIncluye(volcado.archivo, /OWNER TO (migrator|app_t_)/), "trae dueños nuestros");
  assert.ok(!volcadoIncluye(volcado.archivo, /GRANT .* TO app_t_/), "trae permisos nuestros");
});

test("[AC-FTEN-17] restaura STANDALONE, sin pasar por la plantilla, y sin un solo error", async () => {
  // `ON_ERROR_STOP=1` adentro: si algo falla, esto tira. La base destino se crea vacía y NO
  // desde `tenant_template`, para que la prueba sea que el volcado se basta a sí mismo.
  const r = restaurarEn(RESTAURADA, volcado.archivo);
  assert.ok(!/ERROR/i.test(r.salida), r.salida);
});

test("[AC-FTEN-17] los conteos de la restaurada coinciden con los de la original, tabla por tabla", async () => {
  const conteos = async (conexion) => {
    const salida = {};
    for (const t of CONTADAS) {
      const [{ n }] = await conexion.sql(`select count(*)::int as n from ${t}`);
      salida[t] = n;
    }
    return salida;
  };

  const antes = await conteos(original);
  assert.ok(
    Object.values(antes).every((n) => n > 0),
    `alguna tabla quedó vacía y comparar ceros no prueba nada: ${JSON.stringify(antes)}`,
  );

  const restaurada = await conectar(RESTAURADA);
  try {
    assert.deepEqual(await conteos(restaurada), antes);
  } finally {
    await restaurada.cerrar();
  }
});

test("[AC-FTEN-17] la restaurada sigue siendo COHERENTE: el uuid horneado sobrevive al restore", async () => {
  // Ésta es la prueba de la decisión de diseño del §4.1: si `tenant_actual()` leyera
  // `tenant_info` en vez de traer el uuid como literal, el CHECK de cada tabla de dominio
  // habría fallado fila por fila durante el COPY — las funciones se restauran ANTES que los
  // datos — y este restore no habría terminado nunca bien.
  const restaurada = await conectar(RESTAURADA);
  try {
    const [{ actual, coherente, slug }] = await restaurada.sql(
      "select tenant_actual()::text as actual, tenant_coherente() as coherente, " +
        "(select slug from tenant_info) as slug",
    );
    assert.equal(actual, tenant.id, "la constante de la base cambió al restaurar");
    assert.equal(coherente, true);
    assert.equal(slug, SLUG);

    // Y sigue rechazando filas ajenas: los CHECK están vivos, no solo escritos.
    await assert.rejects(
      () =>
        restaurada.sql(
          "insert into review_queue (tenant_id, origen, severidad) " +
            "values ('019fe000-0000-7000-8000-000000000000', 'ajeno', 'alta')",
        ),
      { code: "23514" },
    );
  } finally {
    await restaurada.cerrar();
  }
});

test("[AC-FTEN-17] el append-only del §7.4 también sobrevive: los triggers vienen en el volcado", async () => {
  const restaurada = await conectar(RESTAURADA, { usuario: ROL_MIGRADOR });
  try {
    await assert.rejects(() => restaurada.sql("update eventos set tenant_id = tenant_id"), {
      code: "42501",
    });
  } finally {
    await restaurada.cerrar();
  }
});
