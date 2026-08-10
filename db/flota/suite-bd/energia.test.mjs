#!/usr/bin/env node
// `energy_entry` bajo el rol de app REAL: el centinela 10 del §9.3. [AC-FVEH-08]
//
// Esto NO se puede probar con pgTAP ni por HTTP: pgTAP corre como superusuario y la RLS no se
// le aplica, y el e2e habla con el servidor, que usa el rol de app pero no puede fijar
// `app.current_role` a voluntad. El sujeto del §4.8 es el rol `app_t_<slug>` con su GUC de rol,
// y acá está.
//
// LA MITAD QUE HACE QUE «CERO FILAS» SIGNIFIQUE ALGO: un rol autorizado SÍ ve los montos. Sin
// ella, una tabla vacía cumpliría el test y el reporte de ahorro vs diésel del Anexo A —que se
// calcula sobre esta misma tabla— no tendría de dónde salir.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_energia";
/** La tarifa del fixture. No es un seed del producto: los valores son del hito (g). */
const TARIFA_KWH_CLP = 150;

let tenant;
let app;
let migrador;
let vehiculoId;

/** Corre `fn` dentro de una transacción con el rol declarado por SET LOCAL (§4.1, §7.2). */
async function comoRol(rol, fn) {
  await app.sql("begin");
  try {
    if (rol !== null) await app.sql("select set_config('app.current_role', $1, true)", [rol]);
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

  const [vehiculo] = await migrador.sql(
    "insert into vehiculos (patente, tipo) values ('RLS0001', 'furgón') returning id::text as id",
  );
  vehiculoId = vehiculo.id;
  await migrador.sql("insert into parametros (tarifa_kwh_clp) values ($1)", [TARIFA_KWH_CLP]);

  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FVEH-08] el chofer cierra su recarga sin rebote, y sin mandar un peso", async () => {
  // La captura del terreno entra: la RESTRICTIVE del §4.8 es FOR SELECT y no toca el INSERT.
  await comoRol("chofer", () =>
    app.sql(
      `insert into energy_entry (vehiculo_id, type, wh, soc_inicial, soc_final, ts_dispositivo, tz_offset_min, client_uuid)
       values ($1, 'charge', 20000, 20, 90, now(), -240, uuidv7())`,
      [vehiculoId],
    ),
  );

  const filas = await migrador.sql("select wh, costo_clp from energy_entry");
  assert.equal(filas.length, 1, "la captura del chofer no llegó a la base");
  // Y el costo lo puso el TRIGGER, no el chofer: 20 kWh a la tarifa del tenant, en CLP entero.
  assert.equal(Number(filas[0].costo_clp), (20000 / 1000) * TARIFA_KWH_CLP);
});

for (const rol of ["chofer", "responsable_carga"]) {
  test(`[AC-FVEH-08] centinela 10: con rol \`${rol}\`, energy_entry devuelve 0 filas`, async () => {
    const filas = await comoRol(rol, () => app.sql("select * from energy_entry"));
    assert.deepEqual(filas, [], `${rol} vio la tabla de montos de energía`);
  });
}

test("[AC-FVEH-08] el operador SÍ ve los montos: sin esto, «cero filas» sería vacuo", async () => {
  const filas = await comoRol("operador", () => app.sql("select wh, costo_clp from energy_entry"));
  assert.equal(filas.length, 1, "el operador no puede leer los montos y el reporte se queda sin fuente");
  assert.equal(Number(filas[0].costo_clp), (20000 / 1000) * TARIFA_KWH_CLP);
});

test("[AC-FVEH-08] el replay del chofer no crea una segunda sesión, y NO rebota (centinela 1)", async () => {
  const [{ uuid }] = await migrador.sql("select uuidv7()::text as uuid");
  // Por la FUNCIÓN y no por un `insert … on conflict` a mano: con la RLS activa, el ON CONFLICT
  // necesita LEER la fila en conflicto y el chofer no puede — el replay rebotaría, que es
  // exactamente lo que el §4.2 prohíbe. La función es SECURITY DEFINER justo por eso.
  const enviar = () =>
    comoRol("chofer", () =>
      app.sql(
        "select id::text as id, repetida from registrar_recarga($1, null, 15000, null, null, now(), -240, $2)",
        [vehiculoId, uuid],
      ),
    );
  const [primera] = await enviar();
  const [segunda] = await enviar();
  assert.equal(primera.repetida, false, "la primera no puede venir marcada como repetida");
  assert.equal(segunda.repetida, true, "el replay tiene que venir marcado como repetido");
  assert.equal(segunda.id, primera.id, "el replay devolvió otra fila");

  const [{ n }] = await migrador.sql(
    "select count(*)::int as n from energy_entry where client_uuid = $1",
    [uuid],
  );
  assert.equal(n, 1, "el replay del outbox creó una segunda sesión de recarga");
});
