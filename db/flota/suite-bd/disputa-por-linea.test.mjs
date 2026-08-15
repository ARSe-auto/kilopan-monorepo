#!/usr/bin/env node
// El rol `cliente` disputando SOLO sus líneas, con el rol de app real [AC-FTAR-06].
//
// `disputar_linea()` (0066) corre SIN `SECURITY DEFINER` a propósito, precisamente para que la
// RLS de `liquidacion_lineas` (§9.3.3, `aplicar_rls_de_empresa`, aplicada desde la 0063) decida
// qué línea existe para quién. pgTAP (0031) no puede probar esto: corre como superusuario, y a
// un superusuario la RLS no se le aplica — el mismo motivo por el que AC-FRUT-12 vive acá, con
// `app_t_<slug>` NOSUPERUSER.
//
// Lo que se ejerce: «el rol `cliente` solo disputa líneas de SU `empresa_cliente_id` — línea de
// otra empresa ⇒ 404 y 0 filas» (§3.E1.9, §9.3.3, AC-FTAR-06). Con RLS, ese 404 es 0 filas: la
// política RESTRICTIVE hace desaparecer la línea ajena del primer SELECT dentro de la función,
// y `disputar_linea` devuelve el conjunto vacío — la derivación exacta que pide el §9.3.3.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_disputa_por_linea";

let tenant;
let app;
let migrador;
/** Los ids del fixture, resueltos en `before`. */
const id = {
  suya: "",
  ajena: "",
  lineaSuya: "",
  lineaAjena: "",
  motivo: "",
  autorSuya: "",
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

  // Un destino por encargo: `paradas_una_entrega_por_destino` admite una sola parada `entrega`
  // por destino en cada ruta.
  const destinoSuya = (
    await una(
      "insert into destinos (nombre, comuna) values ('Local del cliente', 'Ñuñoa') returning id::text as id",
    )
  ).id;
  const destinoAjena = (
    await una(
      "insert into destinos (nombre, comuna) values ('Local del vecino', 'Ñuñoa') returning id::text as id",
    )
  ).id;
  const ruta = (
    await una("insert into rutas (nombre) values ('Ruta de la disputa') returning id::text as id")
  ).id;

  for (const empresa of [id.suya, id.ajena]) {
    await migrador.sql(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04')",
      [empresa],
    );
  }

  const paradaSuya = (
    await una(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta, destinoSuya],
    )
  ).id;
  const paradaAjena = (
    await una(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [ruta, destinoAjena],
    )
  ).id;

  const encargoSuya = (
    await una(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
      [id.suya, destinoSuya],
    )
  ).id;
  const encargoAjena = (
    await una(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
      [id.ajena, destinoAjena],
    )
  ).id;

  const podSuya = (
    await una(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-03-15 10:00-04', -240) returning id::text as id",
      [encargoSuya, paradaSuya],
    )
  ).id;
  const podAjena = (
    await una(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-03-15 10:00-04', -240) returning id::text as id",
      [encargoAjena, paradaAjena],
    )
  ).id;

  const liqSuya = (
    await una(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-01-01', date '2026-01-07') returning id::text as id",
      [id.suya],
    )
  ).id;
  const liqAjena = (
    await una(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-01-01', date '2026-01-07') returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.lineaSuya = (await una("select devengar_entrega($1, $2)::text as id", [podSuya, liqSuya])).id;
  id.lineaAjena = (await una("select devengar_entrega($1, $2)::text as id", [podAjena, liqAjena])).id;

  // Las dos liquidaciones cierran: `disputar_linea` solo acepta líneas de una liquidación
  // `cerrada` (AC-FTAR-06).
  await migrador.sql("update liquidaciones set estado = 'cerrada' where id in ($1, $2)", [
    liqSuya,
    liqAjena,
  ]);

  id.motivo = (await una("select id::text as id from motivos where codigo = 'monto_incorrecto'")).id;

  const persona = (
    await una(
      "insert into personas (rut, nombre) values ('11.111.111-1', 'Cliente que disputa') returning id::text as id",
    )
  ).id;
  id.autorSuya = (
    await una(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [persona, id.suya],
    )
  ).id;

  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FTAR-06] el cliente disputa SU línea: el positivo antes que nada", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql(
      "select id::text as id, repetida from disputar_linea($1, $2, $3, $4, $5)",
      [id.lineaSuya, id.motivo, "el monto no cuadra", id.autorSuya, crypto.randomUUID()],
    );
    // El positivo primero: si esto ya diera 0 filas, el negativo de abajo lo cumpliría una
    // política rota que esconde todo, no una que confina de verdad.
    assert.equal(filas.length, 1, "el cliente no pudo disputar su propia línea");
    assert.equal(filas[0].id, id.lineaSuya);
    assert.equal(filas[0].repetida, false);
  });

  const [{ disputa_estado: estado }] = await migrador.sql(
    "select disputa_estado from liquidacion_lineas where id = $1",
    [id.lineaSuya],
  );
  assert.equal(estado, "abierta", "la disputa del cliente no quedó escrita en la BD");
});

test("[AC-FTAR-06] la línea de OTRA empresa es invisible: 0 filas, sin excepción", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql(
      "select id::text as id, repetida from disputar_linea($1, $2, $3, $4, $5)",
      [id.lineaAjena, id.motivo, "intento sobre la línea del vecino", id.autorSuya, crypto.randomUUID()],
    );
    // La misma forma que una línea inexistente (§9.3.3): la política RESTRICTIVE la hace
    // desaparecer del SELECT adentro de `disputar_linea`, que devuelve el conjunto vacío — no
    // lanza excepción, porque una excepción distinguiría «existe pero no es tuya» de «no
    // existe», y esa distinción es exactamente lo que el §9.3.3 prohíbe filtrar.
    assert.equal(filas.length, 0, "el cliente VIO la línea de otra empresa");
  });

  const [{ disputa_estado: estado }] = await migrador.sql(
    "select disputa_estado from liquidacion_lineas where id = $1",
    [id.lineaAjena],
  );
  assert.equal(estado, null, "el intento sobre la línea ajena dejó una disputa escrita");
});

test("[AC-FTAR-06] un cliente SIN empresa declarada tampoco disputa nada", async () => {
  await comoCliente(null, async () => {
    const filas = await app.sql("select id::text as id from disputar_linea($1, $2, $3, $4, $5)", [
      id.lineaSuya,
      id.motivo,
      "nota",
      id.autorSuya,
      crypto.randomUUID(),
    ]);
    assert.equal(filas.length, 0, "una sesión de cliente sin empresa disputó una línea");
  });
});
