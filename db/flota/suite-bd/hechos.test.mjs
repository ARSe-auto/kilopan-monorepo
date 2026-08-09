#!/usr/bin/env node
// DDL transversal de hechos, evidencia y revisión contra el cluster real [AC-FTEN-24].
//
// Este módulo entrega ESQUEMA, no conducta: acá se verifica que las tablas del §4.6 existen
// en `tenant_template` con su clase de la regla de oro, sus enums cerrados, su `tenant_id`
// atado a la constante de la BD y el append-only del §7.4 por sus DOS caminos — el REVOKE al
// rol de app y el trigger que también detiene a quien tiene más privilegios.
//
// Provisiona su propio tenant y lo borra al final: escribir hechos en `t_gate_a` dejaría
// filas que las otras suites no esperan.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar, refrescarPlantilla } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, BD_PLANTILLA, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_hechos";
const APPEND_ONLY = ["eventos", "evidence", "audit_trail", "client_metric"];
const SHA_DE_32 = "\\x" + "ab".repeat(32);

let tenant;
/** Conexión con el rol de app real: es el sujeto del rebote del §9.3.6. */
let app;
/** Conexión del migrador: para probar que el trigger detiene también a quien puede más. */
let migrador;
let tipoEvento;

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
  await refrescarPlantilla();
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });
  [tipoEvento] = await migrador.sql(
    "insert into evento_tipo (codigo, descripcion) values ('prueba.gate', 'fixture del gate') " +
      "returning id::text as id",
  );
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FTEN-24] las tablas del §4.6 nacen en `tenant_template`, con su clase de la regla de oro", async () => {
  const clases = await con(BD_PLANTILLA, ({ sql }) =>
    sql(
      `select c.relname, obj_description(c.oid, 'pg_class') as clase
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)
        order by c.relname`,
      [["eventos", "evidence", "audit_trail", "client_metric", "review_queue", "evento_tipo"]],
    ),
  );
  assert.equal(clases.length, 6, "falta alguna tabla del §4.6 en la plantilla");
  for (const t of clases) {
    assert.match(
      t.clase ?? "",
      /^(PLANIFICACIÓN|CAPTURA) —/,
      `${t.relname} no declara su clase del §4.2: «${t.clase}»`,
    );
  }
});

test("[AC-FTEN-24] los enums son CERRADOS y con los valores literales del §4.6", async () => {
  const valores = async (tipo) =>
    (
      await app.sql(
        "select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid " +
          "where t.typname = $1 order by e.enumsortorder",
        [tipo],
      )
    ).map((f) => f.enumlabel);

  assert.deepEqual(await valores("evidencia_tipo"), [
    "firma",
    "foto",
    "lectura",
    "indicador_visual",
    "archivo_logger",
    "documento",
    "pin_destinatario",
    "escaneo_codigo",
  ]);
  assert.deepEqual(await valores("metrica_cliente"), [
    "toques_flujo",
    "eviccion_idb",
    "persist_denegado",
    "outbox_profundidad",
    "outbox_edad_max",
    "pwa_version",
    "sync_error",
    "latencia_ms",
  ]);
  assert.deepEqual(await valores("revision_estado"), ["nueva", "reconocida", "resuelta"]);

  // Cerrado de verdad: un valor de más rebota en la BD, no en la aplicación.
  await assert.rejects(
    () =>
      app.sql(
        "insert into client_metric (tipo, valor_int, ts, tz_offset_min, client_uuid) " +
          "values ('inventado', 1, now(), -240, uuidv7())",
      ),
    { code: "22P02" },
  );
});

test("[AC-FTEN-24] `tenant_id` se hornea solo y un tenant ajeno rebota contra la constante", async () => {
  const [fila] = await app.sql(
    "insert into review_queue (origen, severidad) values ('gate', 'alta') " +
      "returning tenant_id::text as tenant_id",
  );
  assert.equal(fila.tenant_id, tenant.id, "el DEFAULT no puso la constante de la BD");

  await assert.rejects(
    () =>
      app.sql(
        "insert into review_queue (tenant_id, origen, severidad) " +
          "values ('019fe000-0000-7000-8000-000000000000', 'ajeno', 'alta')",
      ),
    { code: "23514" },
    "una fila de otro tenant entró a la BD de este",
  );
});

test("[AC-FTEN-24] la app ESCRIBE hechos (2xx) pero no puede editarlos ni borrarlos ⇒ 42501", async () => {
  // La mitad positiva primero: sin ella, un rol sin ningún permiso daría los mismos 42501.
  await app.sql(
    "insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min) " +
      "values ($1, 'review_queue', uuidv7(), now(), -240)",
    [tipoEvento.id],
  );
  await app.sql(
    "insert into evidence (tipo, objeto_tabla, objeto_id, valor, capturada_en, tz_offset_min) " +
      "values ('pin_destinatario', 'review_queue', uuidv7(), '1234', now(), -240)",
  );
  await app.sql(
    "insert into client_metric (tipo, valor_int, ts, tz_offset_min, client_uuid) " +
      "values ('toques_flujo', 3, now(), -240, uuidv7())",
  );

  for (const tabla of APPEND_ONLY) {
    const [{ n }] = await app.sql(`select count(*)::int as n from ${tabla}`);
    assert.ok(n > 0, `${tabla} está vacía: el rebote de abajo no probaría nada`);
    await assert.rejects(() => app.sql(`update ${tabla} set tenant_id = tenant_id`), {
      code: "42501",
    });
    await assert.rejects(() => app.sql(`delete from ${tabla}`), { code: "42501" });
  }
});

test("[AC-FTEN-24] el append-only detiene también al MIGRADOR: el REVOKE solo no alcanza", async () => {
  // El REVOKE protege de la aplicación. Un script de mantenimiento corre con el rol dueño y
  // pasaría por encima; el trigger es lo que hace que «append-only» sea del esquema.
  for (const tabla of APPEND_ONLY) {
    // Con la tabla vacía, un UPDATE de cero filas no dispara un trigger FOR EACH ROW y el
    // rebote se leería como verde. Lo destapó esta misma suite cuando el INSERT de arriba
    // falló por permisos y estos asertos siguieron pasando.
    const [{ n }] = await migrador.sql(`select count(*)::int as n from ${tabla}`);
    assert.ok(n > 0, `${tabla} está vacía: un UPDATE de 0 filas no ejerce el trigger`);
    await assert.rejects(
      () => migrador.sql(`update ${tabla} set tenant_id = tenant_id`),
      (e) => {
        assert.equal(e.code, "42501", `${tabla} respondió ${e.code}`);
        assert.match(e.message, /append-only/);
        return true;
      },
    );
    await assert.rejects(() => migrador.sql(`truncate ${tabla}`), { code: "42501" });
  }
});

test("[AC-FTEN-24] `audit_trail` se escribe POR TRIGGER, con el antes y el después", async () => {
  const [fila] = await app.sql(
    "insert into review_queue (origen, severidad) values ('auditada', 'media') returning id::text as id",
  );
  await app.sql("update review_queue set asignado_a = uuidv7() where id = $1", [fila.id]);

  const rastro = await app.sql(
    "select operacion, antes, despues from audit_trail where registro_id = $1 order by ocurrido_en",
    [fila.id],
  );
  assert.deepEqual(
    rastro.map((r) => r.operacion),
    ["INSERT", "UPDATE"],
  );
  assert.equal(rastro[0].antes, null, "un INSERT no tiene «antes»");
  assert.equal(rastro[0].despues.origen, "auditada");
  assert.equal(rastro[1].antes.asignado_a, null);
  assert.ok(rastro[1].despues.asignado_a, "el «después» del UPDATE no trae el valor nuevo");
});

test("[AC-FTEN-24] `evidence`: hay sha256 en cuanto hay binario, y no se exige donde no lo hay", async () => {
  // «El sha256 viaja en la mutación ANTES del binario» (§4.6): la exigencia se ata a que HAYA
  // archivo, no a una lista de tipos que se desactualizaría con el primer vertical nuevo.
  await assert.rejects(
    () =>
      app.sql(
        "insert into evidence (tipo, objeto_tabla, objeto_id, archivo_url, capturada_en, tz_offset_min) " +
          "values ('foto', 'paradas', uuidv7(), 'https://x/y.jpg', now(), -240)",
      ),
    { code: "23514" },
    "entró un binario sin su sha256",
  );
  await app.sql(
    "insert into evidence (tipo, objeto_tabla, objeto_id, archivo_url, sha256, capturada_en, tz_offset_min) " +
      `values ('foto', 'paradas', uuidv7(), 'https://x/y.jpg', '${SHA_DE_32}', now(), -240)`,
  );
  await assert.rejects(
    () =>
      app.sql(
        "insert into evidence (tipo, objeto_tabla, objeto_id, archivo_url, sha256, capturada_en, tz_offset_min) " +
          "values ('foto', 'paradas', uuidv7(), 'https://x/z.jpg', '\\x00', now(), -240)",
      ),
    { code: "23514" },
    "un sha256 que no mide 32 bytes no es un sha256",
  );
});

test("[AC-FTEN-24] `eventos` lleva secuencia monotónica POR TENANT: es el orden autoritativo", async () => {
  const secuencia = async () =>
    (
      await app.sql(
        "insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min) " +
          "values ($1, 'orden', uuidv7(), now(), -240) returning secuencia",
        [tipoEvento.id],
      )
    )[0].secuencia;

  const a = Number(await secuencia());
  const b = Number(await secuencia());
  assert.ok(b > a, `la secuencia no avanzó: ${a} → ${b}`);
});

test("[AC-FTEN-24] `review_queue` no se puede resolver sin nota, y sus transiciones son del módulo 05", async () => {
  const [fila] = await app.sql(
    "insert into review_queue (origen, severidad) values ('sin_nota', 'baja') returning id::text as id",
  );
  await assert.rejects(
    () => app.sql("update review_queue set estado = 'resuelta' where id = $1", [fila.id]),
    { code: "23514" },
  );
  // Con nota sí: el CHECK es del esquema; el 422 de la transición lo pone el módulo 05.
  await app.sql("update review_queue set estado = 'resuelta', nota = 'listo' where id = $1", [
    fila.id,
  ]);
  const [{ estado }] = await app.sql("select estado from review_queue where id = $1", [fila.id]);
  assert.equal(estado, "resuelta");
});

// --- reading: append-only con el rol de app real --------------------------------- [AC-FTEN-14]
// El §9.3.6 pide el 42501 con el rol `app_t_<slug>`, y eso no lo puede probar pgTAP: corre
// como superusuario, a quien ni el REVOKE ni la RLS se le aplican.

test("[AC-FTEN-14] la app INSERTA lecturas pero no puede editarlas ni borrarlas ⇒ 42501", async () => {
  const [magnitud] = await migrador.sql(
    "insert into magnitud (codigo, unidad) values ('soc', 'decimas_de_pct') returning id::text as id",
  );

  // La mitad positiva: la lectura entra, y entra FUERA de rango a propósito. `valor_int` no
  // lleva CHECK (§0 fila SOC): una sonda descalibrada no puede rebotar la captura del chofer.
  await app.sql(
    `insert into reading (magnitud_id, valor_int, fuente, ts_dispositivo, tz_offset_min)
     values ($1, 1350, 'sonda_vehiculo', now(), -240)`,
    [magnitud.id],
  );
  const [{ n }] = await app.sql("select count(*)::int as n from reading");
  assert.equal(n, 1, "la lectura fuera de rango no entró, y tenía que entrar con flag");

  await assert.rejects(() => app.sql("update reading set valor_int = 100"), { code: "42501" });
  await assert.rejects(() => app.sql("delete from reading"), { code: "42501" });
});

test("[AC-FTEN-14] la idempotencia doble de `reading` está viva, no solo declarada", async () => {
  const [magnitud] = await migrador.sql("select id::text as id from magnitud where codigo = 'soc'");
  const ts = new Date().toISOString();

  await app.sql(
    `insert into reading (magnitud_id, valor_int, fuente, instrumento_id, sensor, ts_dispositivo, tz_offset_min)
     values ($1, 400, 'archivo_logger', '019fe400-0000-7000-8000-000000000001', 'sonda-1', $2, -240)`,
    [magnitud.id, ts],
  );
  // El archivo de un logger reimportado no trae client_uuid: lo que lo hace idempotente es la
  // tripleta (instrumento, sensor, ts_dispositivo).
  await assert.rejects(
    () =>
      app.sql(
        `insert into reading (magnitud_id, valor_int, fuente, instrumento_id, sensor, ts_dispositivo, tz_offset_min)
         values ($1, 400, 'archivo_logger', '019fe400-0000-7000-8000-000000000001', 'sonda-1', $2, -240)`,
        [magnitud.id, ts],
      ),
    { code: "23505" },
  );
});

test("[AC-FTEN-14] los ganchos vivos nacen SIN seeds: ni de frío, ni de carga, ni de evidencia", async () => {
  // El §4.9 y el §5.2 F4 son explícitos: las tablas nacen vacías y el primer vertical las
  // llena. Un seed acá convertiría una decisión del tenant en una decisión nuestra.
  for (const tabla of ["cargo_type", "attribute_definition", "stop_requirement", "lot", "reference_document"]) {
    const [{ n }] = await con(BD_PLANTILLA, ({ sql }) =>
      sql(`select count(*)::int as n from ${tabla}`),
    );
    assert.equal(n, 0, `${tabla} nace con ${n} filas sembradas en la plantilla`);
  }
});
