#!/usr/bin/env node
// Orden autoritativo del servidor y proyección del estado visible [AC-FPOD-21] — §4.6, §2.
//
// El servidor asigna `eventos.secuencia` con `nextval(eventos_secuencia_seq)` AL ATERRIZAR
// (0002): es monotónica por LLEGADA, nunca por el `event_time` que trae el dispositivo. Esta
// suite ejerce el caso que hace real esa garantía contra el camino REAL de
// `/api/sync/capturas` (`aterrizarCapturas`, `servidor/capturas.ts`): dos capturas sobre la
// MISMA parada con `event_time` INVERTIDO respecto de su orden de llegada — el escenario de
// drift/offline que el §4.6 anticipa —, y prueba que:
//
//   (a) las dos aterrizan 2xx (`aceptada: true`, jamás un rebote — regla de oro §4.2);
//   (b) la SEGUNDA en llegar recibe la secuencia MAYOR, aunque su `event_time` sea el más
//       temprano de las dos (orden AUTORITATIVO del servidor, no del reloj del aparato);
//   (c) `servidor/paradas.ts::estadoVisibleDeParada` — la proyección — refleja la que llegó
//       SEGUNDA, no la de `event_time` más tardío ni la primera del array.
//
// El «test de esquema o grep» de que el estado visible deriva de `eventos` y no de un contador
// mutable es `gate-sin-contadores-mutables.mjs`, estático y en la sección sin BD de `gate.sh`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { provisionar, refrescarPlantilla, desalta } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, urlDe, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import { aterrizarCapturas } from "../../../apps/flota/src/servidor/capturas.ts";
import { estadoVisibleDeParada } from "../../../apps/flota/src/servidor/paradas.ts";

const SLUG = "gate_orden";

/** Una sesión de chofer sintética: `dispositivos`/`personas` no tienen FK desde `eventos`
 *  (0002), así que un uuid arbitrario alcanza — igual que `pod-inmutable.test.mjs`. */
const SESION = {
  dispositivoId: "019fe000-0000-7000-8000-0000000000d1",
  personaId: "019fe000-0000-7000-8000-0000000000c1",
  usuarioId: "019fe000-0000-7000-8000-000000000001",
  rol: "chofer",
  isStandalone: true,
  storagePersisted: true,
  empresaClienteId: null,
};

let tenant;
let pool;
let migrador;
let fixture;

function capturaBase(datos) {
  return {
    clientUuid: datos.clientUuid,
    paradaId: fixture.parada,
    tsDispositivo: datos.tsDispositivo,
    tzOffsetMin: -240,
    resultado: datos.resultado,
    metodoEntrega: null,
    motivoId: null,
    items: null,
    evidencias: [],
    turnoId: null,
    secuenciaDispositivo: null,
    supersedeDe: null,
    motivo: null,
  };
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
  await refrescarPlantilla();
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  pool = new pg.Pool({ connectionString: urlDe(tenant.bd, { usuario: tenant.rol, clave: tenant.clave }) });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });

  await migrador.sql("insert into destinos (nombre) values ('Destino del gate de orden')");
  await migrador.sql("insert into rutas (nombre) values ('Ruta del gate de orden')");
  const [parada] = await migrador.sql(
    "insert into paradas (ruta_id, tipo, orden, destino_id) " +
      "select (select id from rutas limit 1), 'entrega', 1, (select id from destinos limit 1) " +
      "returning id::text as id",
  );
  fixture = { parada: parada.id };

  // Sella una config_version PROPIA antes de capturar: sin ella, `configDeLaCaptura`
  // (servidor/capturas.ts) cae a `versionVigente`, que consulta el plano de `control` para la
  // PRIMERA versión de un tenant — y esta suite no registra `gate_orden` ahí. Sellarla acá es
  // el mismo mecanismo que el servidor usaría en producción, adelantado.
  await migrador.sql("select crear_config_version('fixture del gate de orden', '{}'::jsonb)");
});

after(async () => {
  await pool?.end();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FPOD-21] event_time invertido: ambas aterrizan 2xx, la segunda en llegar recibe la secuencia mayor, y la proyección la refleja", async () => {
  // A es la que llega PRIMERO al servidor, con el event_time MÁS TARDÍO de las dos (12:00).
  const [acuseA] = await aterrizarCapturas(
    pool,
    SESION,
    SLUG,
    [
      capturaBase({
        clientUuid: "019fe000-0000-7000-8000-0000000000a1",
        tsDispositivo: new Date("2026-08-11T12:00:00Z"),
        resultado: "exito",
      }),
    ],
    null,
  );
  assert.equal(acuseA.aceptada, true, "la captura A rebotó — la regla de oro del §4.2 es 2xx siempre");

  // B llega SEGUNDO al servidor, pero con un event_time MÁS TEMPRANO (09:00) — drift/offline.
  const [acuseB] = await aterrizarCapturas(
    pool,
    SESION,
    SLUG,
    [
      capturaBase({
        clientUuid: "019fe000-0000-7000-8000-0000000000b2",
        tsDispositivo: new Date("2026-08-11T09:00:00Z"),
        resultado: "fallo",
      }),
    ],
    null,
  );
  assert.equal(acuseB.aceptada, true, "la captura B rebotó — la regla de oro del §4.2 es 2xx siempre");

  const filas = await migrador.sql(
    `select e.secuencia::text as secuencia, e.event_time,
            e.payload ->> 'resultado' as resultado
       from eventos e join evento_tipo t on t.id = e.tipo_id
      where e.objeto_tabla = 'paradas' and e.objeto_id = $1 and t.codigo = 'entrega.pod_capturada'
      order by e.secuencia`,
    [fixture.parada],
  );
  assert.equal(filas.length, 2, "las dos capturas tienen que haber aterrizado en `eventos`");

  // El fixture ejerce de verdad la inversión: la fila de secuencia MENOR (A, la que llegó
  // primero) tiene el event_time MÁS TARDÍO de las dos. Si esto no se cumpliera, el test de
  // abajo pasaría por casualidad y no por lo que dice probar.
  assert.ok(
    new Date(filas[0].event_time) > new Date(filas[1].event_time),
    "el fixture no invirtió event_time respecto de la secuencia — la prueba no ejerce el AC",
  );
  assert.ok(
    BigInt(filas[0].secuencia) < BigInt(filas[1].secuencia),
    "la secuencia no es creciente por orden de LLEGADA — dejó de ser el orden autoritativo del §4.6",
  );
  assert.equal(filas[0].resultado, "exito", "la secuencia menor tiene que ser A (llegó primero)");
  assert.equal(filas[1].resultado, "fallo", "la secuencia mayor tiene que ser B (llegó segundo)");

  const visible = await estadoVisibleDeParada(pool, SESION, fixture.parada);
  assert.deepEqual(
    visible,
    { estado: "done", resultado: "fallo", metodoEntrega: null, motivoId: null },
    "la proyección de estado visible no siguió el orden autoritativo del servidor (secuencia) — " +
      "si mirara `event_time` en cambio, devolvería 'exito' (A, la de las 12:00), que es " +
      "exactamente lo que AC-FPOD-21 prohíbe",
  );
});

test("[AC-FPOD-21] una parada sin ninguna captura proyecta `pending`, no un valor inventado", async () => {
  // Destino PROPIO: `paradas_una_entrega_por_destino` (0037) admite una sola parada de tipo
  // `entrega` por (ruta, destino), y la del fixture ya ocupa el suyo.
  const [destino] = await migrador.sql(
    "insert into destinos (nombre) values ('Segundo destino del gate de orden') returning id::text as id",
  );
  const [otraParada] = await migrador.sql(
    "insert into paradas (ruta_id, tipo, orden, destino_id) " +
      "values ((select id from rutas limit 1), 'entrega', 2, $1) returning id::text as id",
    [destino.id],
  );
  const visible = await estadoVisibleDeParada(pool, SESION, otraParada.id);
  assert.deepEqual(visible, { estado: "pending", resultado: null, metodoEntrega: null, motivoId: null });
});

test("[AC-FPOD-21] una parada que no existe proyecta `null`, no `pending` — no hay a qué colgar el estado", async () => {
  const visible = await estadoVisibleDeParada(pool, SESION, "019fe000-0000-7000-8000-000000000000");
  assert.equal(visible, null);
});
