#!/usr/bin/env node
// El rol `cliente` confinado a SU empresa en TODA tabla del portal DaaS, con el rol de app
// real [AC-FPOR-05].
//
// `db/flota/suite-bd/confinamiento.test.mjs` (AC-FRUT-12) ya prueba, con `app_t_<slug>`
// NOSUPERUSER/NOBYPASSRLS, la confinación real sobre `encargos`/`items`/`paradas`/`rutas`/
// `usuarios`, y su último caso barre TODA tabla del esquema con `empresa_cliente_id` exigiendo
// que lleve política restrictiva — un invariante ESTRUCTURAL (¿existe la política?) que se
// pondría rojo si una tabla nueva llegara sin confinar. `disputa-por-linea.test.mjs`
// (AC-FTAR-06) ya prueba el mismo confinamiento, en carne, sobre `liquidacion_lineas`.
//
// Lo que faltaba, y lo que exige el §9.3.3 con las palabras «TODA tabla operativa», es el caso
// de COMPORTAMIENTO (¿la fila de la otra empresa aparece o no?) sobre las tablas del hito f
// que ningún AC anterior ejerció con datos reales: `tarifas`, `tarifa_zonas`,
// `tarifa_recargo_horario` y `liquidaciones` — y, sobre esa base, que las vistas del §4.3
// (`liquidacion_cliente`, `liquidacion_lineas_cliente`, 0067) confinan EXACTAMENTE igual que
// la tabla que envuelven, porque corren `security_invoker` y no agregan aislamiento propio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar, desalta } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_confinamiento_portal";

let tenant;
let app;
let migrador;
/** Los ids del fixture, resueltos en `before`. */
const id = {
  suya: "",
  ajena: "",
  tarifaSuya: "",
  tarifaAjena: "",
  zonaSuya: "",
  zonaAjena: "",
  recargoSuya: "",
  recargoAjena: "",
  liqSuya: "",
  liqAjena: "",
  lineaSuya: "",
  lineaAjena: "",
};

/** Mismo helper que `confinamiento.test.mjs`: `set_config(..., true)` es LOCAL a la transacción. */
async function comoCliente(empresa, fn) {
  await app.sql("begin");
  try {
    await app.sql("select set_config('app.current_role', 'cliente', true)");
    await app.sql("select set_config('app.current_empresa', $1, true)", [empresa ?? ""]);
    return await fn();
  } finally {
    await app.sql("commit");
  }
}

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
  // Complemento del alta en `control.tenants` [AC-FPOR-01]: sin esto, la fila sobrevive al
  // DROP DATABASE y el job exportador la reporta huérfana en la corrida siguiente.
  await desalta(SLUG);
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

  const una = async (texto, params = []) => (await migrador.sql(texto, params))[0];

  id.suya = (
    await una(
      "insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería del cliente') returning id::text as id",
    )
  ).id;
  id.ajena = (
    await una(
      "insert into empresas_cliente (rut, razon_social) values ('77.222.222-K', 'Pastelería de al lado') returning id::text as id",
    )
  ).id;

  id.tarifaSuya = (
    await una(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04') returning id::text as id",
      [id.suya],
    )
  ).id;
  id.tarifaAjena = (
    await una(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 4200, timestamptz '2026-01-01 00:00-04') returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.zonaSuya = (
    await una(
      "insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp) values ($1, 'Centro', array['Ñuñoa'], 1000) returning id::text as id",
      [id.suya],
    )
  ).id;
  id.zonaAjena = (
    await una(
      "insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp) values ($1, 'Oriente', array['Las Condes'], 1500) returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.recargoSuya = (
    await una(
      "insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp) values ($1, '20:00', '23:00', 800) returning id::text as id",
      [id.suya],
    )
  ).id;
  id.recargoAjena = (
    await una(
      "insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp) values ($1, '21:00', '23:59', 900) returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.liqSuya = (
    await una(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-01-01', date '2026-01-07') returning id::text as id",
      [id.suya],
    )
  ).id;
  id.liqAjena = (
    await una(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-01-01', date '2026-01-07') returning id::text as id",
      [id.ajena],
    )
  ).id;

  // Las líneas solo las crea `devengar_entrega()` (§7.5, AC-FTAR-03): acá se abre la MISMA
  // marca local que esa función levanta, dentro de una transacción propia, para sembrar sin
  // pasar por todo el circuito parada→pod que `disputa-por-linea.test.mjs` ya ejerce.
  await migrador.sql("begin");
  id.lineaSuya = (
    await una(
      `insert into liquidacion_lineas
         (liquidacion_id, empresa_cliente_id, evidencia_tipo, evidencia_id, concepto, tarifa_id,
          cantidad, precio_base_clp, modificadores_clp, monto_clp)
       select $1, $2, 'entrega_pod', gen_random_uuid(), 'por_entrega', $3, 1, 3500, 0, 3500
        from (select set_config('app.devengo_en_curso', 'si', true)) _marca
       returning id::text as id`,
      [id.liqSuya, id.suya, id.tarifaSuya],
    )
  ).id;
  await migrador.sql("commit");

  await migrador.sql("begin");
  id.lineaAjena = (
    await una(
      `insert into liquidacion_lineas
         (liquidacion_id, empresa_cliente_id, evidencia_tipo, evidencia_id, concepto, tarifa_id,
          cantidad, precio_base_clp, modificadores_clp, monto_clp)
       select $1, $2, 'entrega_pod', gen_random_uuid(), 'por_entrega', $3, 1, 4200, 0, 4200
        from (select set_config('app.devengo_en_curso', 'si', true)) _marca
       returning id::text as id`,
      [id.liqAjena, id.ajena, id.tarifaAjena],
    )
  ).id;
  await migrador.sql("commit");

  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

// ─── El CHECK del §4.3: alta sin empresa ⇒ rebote ────────────────────────────────────

test("[AC-FPOR-05] alta de un `cliente` sin empresa rebota (usuarios_cliente_con_empresa)", async () => {
  // Las dos direcciones del CHECK, con el rol de app real, ya viven en AC-FIDN-01
  // (`identidad.test.mjs`); esta es la evidencia propia de AC-FPOR-05 sobre la MISMA
  // constraint, que es la mitad del oráculo de este AC («constraint que exige
  // empresa_cliente_id NOT NULL cuando rol=cliente»).
  // RUT de la lista congelada (§7.8, AC-FIDN-21, db/flota/ruts-sinteticos.mjs): «cuerpo de
  // siete dígitos», no marcado exclusivo de ninguna otra suite.
  const persona = (
    await migrador.sql(
      "insert into personas (rut, nombre) values ('5.126.663-3', 'Sin empresa') returning id::text as id",
    )
  )[0];
  assert.equal(
    await codigoDe(app, "insert into usuarios (persona_id, rol) values ($1, 'cliente')", [persona.id]),
    "23514",
    "un `cliente` sin empresa_cliente_id entró a la BD",
  );
});

// ─── Comportamiento real sobre las tablas del hito f, con el rol de app real ─────────

test("[AC-FPOR-05] tarifas: el cliente ve SOLO las de su empresa", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from tarifas");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.tarifaSuya), "el contratante no ve su propia tarifa");
    assert.ok(!ids.includes(id.tarifaAjena), "el contratante VE la tarifa de otra empresa");
  });
});

test("[AC-FPOR-05] tarifa_zonas: el cliente ve SOLO las de su empresa", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from tarifa_zonas");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.zonaSuya), "el contratante no ve su propia zona");
    assert.ok(!ids.includes(id.zonaAjena), "el contratante VE la zona de otra empresa");
  });
});

test("[AC-FPOR-05] tarifa_recargo_horario: el cliente ve SOLO las de su empresa", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from tarifa_recargo_horario");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.recargoSuya), "el contratante no ve su propio recargo horario");
    assert.ok(!ids.includes(id.recargoAjena), "el contratante VE el recargo de otra empresa");
  });
});

test("[AC-FPOR-05] liquidaciones: el cliente ve SOLO la de su empresa", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from liquidaciones");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.liqSuya), "el contratante no ve su propia liquidación");
    assert.ok(!ids.includes(id.liqAjena), "el contratante VE la liquidación de otra empresa");
  });
});

test("[AC-FPOR-05] liquidacion_lineas: el cliente ve SOLO las líneas de su empresa", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from liquidacion_lineas");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.lineaSuya), "el contratante no ve su propia línea");
    assert.ok(!ids.includes(id.lineaAjena), "el contratante VE la línea de otra empresa");
  });
});

test("[AC-FPOR-05] un cliente SIN empresa declarada no ve ninguna fila del hito f", async () => {
  await comoCliente(null, async () => {
    for (const tabla of ["tarifas", "tarifa_zonas", "tarifa_recargo_horario", "liquidaciones", "liquidacion_lineas"]) {
      const filas = await app.sql(`select 1 from ${tabla}`);
      assert.equal(filas.length, 0, `${tabla}: un cliente sin empresa vio filas`);
    }
  });
});

test("[AC-FPOR-05] sin rol declarado: la política de EMPRESA no estorba, la de DINERO falla cerrado", async () => {
  // Gemelo del test de `aislamiento-cliente-modulo-tarifas`, y cambió por la misma razón: desde
  // la migración 0073 [AC-FTAR-17] las tablas con montos llevan ADEMÁS la RLS de dinero del
  // §4.8, cuya política restrictiva exige `app.current_role` declarado. Sin sesión no se ven
  // montos — falla cerrado, igual que `energy_entry` desde la 0004.
  const tarifas = await app.sql("select id::text as id from tarifas");
  assert.deepEqual(
    tarifas,
    [],
    "sin rol declarado se vieron tarifas: la política de dinero del §4.8 debe fallar cerrada",
  );

  // La cabecera de liquidación NO lleva montos —viven en `liquidacion_lineas`— así que solo
  // tiene la política de empresa, y esa sigue sin estorbar: el operador de la casa ve las dos.
  const liquidaciones = await app.sql("select id::text as id from liquidaciones");
  const idsLiq = liquidaciones.map((f) => f.id);
  assert.ok(
    idsLiq.includes(id.liqSuya) && idsLiq.includes(id.liqAjena),
    "el operador sin rol declarado dejó de ver las dos empresas en la cabecera de liquidación",
  );
});

// ─── Las vistas del §4.3: la vía sancionada para leer liquidación ────────────────────

test("[AC-FPOR-05] liquidacion_cliente y liquidacion_lineas_cliente son security_invoker", async () => {
  const vistas = await migrador.sql(
    `select c.relname,
            ('security_invoker=true' = any (coalesce(c.reloptions, array[]::text[]))) as invoker
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('liquidacion_cliente', 'liquidacion_lineas_cliente')
      order by c.relname`,
  );
  assert.equal(vistas.length, 2, "faltan una o las dos vistas del §4.3");
  for (const v of vistas) {
    assert.equal(v.invoker, true, `${v.relname} no es security_invoker (AC-FVEH-13, 0035)`);
  }
});

test("[AC-FPOR-05] el cliente lee su liquidación a través de la vista, confinada igual que la tabla", async () => {
  await comoCliente(id.suya, async () => {
    const cabecera = await app.sql("select id::text as id from liquidacion_cliente");
    const idsCabecera = cabecera.map((f) => f.id);
    assert.ok(idsCabecera.includes(id.liqSuya), "la vista no muestra la liquidación propia");
    assert.ok(!idsCabecera.includes(id.liqAjena), "la vista muestra la liquidación de otra empresa");

    const lineas = await app.sql("select id::text as id from liquidacion_lineas_cliente");
    const idsLineas = lineas.map((f) => f.id);
    assert.ok(idsLineas.includes(id.lineaSuya), "la vista no muestra la línea propia");
    assert.ok(!idsLineas.includes(id.lineaAjena), "la vista muestra la línea de otra empresa");
  });
});
