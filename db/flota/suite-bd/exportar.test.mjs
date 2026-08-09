#!/usr/bin/env node
// El job exportador contra el cluster real [AC-FTEN-20].
//
// Ejercita la única vía por la que un dato sale de la BD de un tenant: dos conexiones
// separadas, lectura de una y escritura en la otra. Ninguna consulta ve las dos bases a la
// vez, que es lo que el §4.1/§7.2 prohíbe.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { exportar, agregadosDe, ventanaDe } from "../exportar.mjs";
import { migrar } from "../migrar.mjs";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, BD_CONTROL, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_export";
// Reloj REAL y no una fecha fija: `eventos_ultima_hora` es «la última hora desde ahora» por
// definición, así que una ventana de 2026 congelada la dejaría siempre en cero. La alineación
// de la ventana, que sí es lógica pura, se fija con fechas literales en `exportar.test.mjs`.
// Anclado al COMIENZO del tramo vigente, no a un instante cualquiera: la prueba del upsert
// corre el job dos veces con 90 s de diferencia, y si el reloj cayera cerca del borde del
// tramo la segunda corrida caería en el siguiente y crearía una fila legítima. Se puso rojo
// en el gate justamente así.
const AHORA = new Date(ventanaDe(new Date()).inicio.getTime() + 30_000);

let control;
let tenant;
let migrador;
let idTenantEnControl;

async function limpiar() {
  // Los agregados primero: son hijos del registro de tenants y la FK no perdona el orden.
  await con(BD_CONTROL, async ({ sql }) => {
    await sql(
      "delete from agregados_tecnicos where tenant_id in (select id from tenants where slug like 'gate_export%')",
    );
    await sql("delete from tenants where slug like 'gate_export%'");
  });
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
  await migrar();
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  control = await conectar(BD_CONTROL);
  [{ id: idTenantEnControl }] = await control.sql(
    "insert into tenants (slug, bd) values ($1, $2) returning id::text as id",
    [SLUG, tenant.bd],
  );

  // Fixture de actividad DENTRO de la ventana, con `record_time` forzado: el doble reloj del
  // §4.6 permite justamente esto — la hora del servidor no tiene por qué ser la de ahora.
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });
  const { inicio } = ventanaDe(AHORA);
  const dentro = new Date(inicio.getTime() + 60_000).toISOString();
  const [tipo] = await migrador.sql(
    "insert into evento_tipo (codigo, descripcion) values ('gate.export', 'fixture') returning id::text as id",
  );
  await migrador.sql(
    `insert into eventos (tipo_id, objeto_tabla, objeto_id, actor_id, event_time, tz_offset_min, record_time)
     values ($1, 'gate', uuidv7(), '019fe200-0000-7000-8000-000000000001', $2, -240, $2),
            ($1, 'gate', uuidv7(), '019fe200-0000-7000-8000-000000000001', $2, -240, $2),
            ($1, 'gate', uuidv7(), '019fe200-0000-7000-8000-000000000002', $2, -240, $2)`,
    [tipo.id, dentro],
  );
  await migrador.sql(
    `insert into client_metric (dispositivo_id, tipo, valor_int, ts, tz_offset_min, record_time, client_uuid)
     values ('019fe300-0000-7000-8000-000000000001', 'sync_error',  1, $1, -240, $1, uuidv7()),
            ('019fe300-0000-7000-8000-000000000001', 'toques_flujo', 4, $1, -240, $1, uuidv7()),
            ('019fe300-0000-7000-8000-000000000002', 'toques_flujo', 3, $1, -240, $1, uuidv7()),
            ('019fe300-0000-7000-8000-000000000002', 'pwa_version', 41, $1, -240, $1, uuidv7())`,
    [dentro],
  );
});

after(async () => {
  await migrador?.cerrar();
  await control?.cerrar();
  await limpiar();
});

test("[AC-FTEN-20] los agregados salen de `eventos` y `client_metric`, y de ninguna otra tabla", async () => {
  const a = await agregadosDe(tenant.bd, ventanaDe(AHORA));
  assert.equal(a.usuarios_activos, 2, "dos actores distintos en la ventana");
  assert.equal(a.dispositivos_activos, 2, "dos dispositivos distintos en la ventana");
  assert.equal(a.errores_sync_pct, 25, "1 error sobre 4 métricas");
  assert.equal(a.pwa_version_min, "41");
  assert.ok(a.eventos_ultima_hora >= 3);
});

test("[AC-FTEN-20] los campos sin fuente operativa quedan NULL DECLARADO, no cero inventado", async () => {
  // Un cero diría «medido y da cero», que es una afirmación distinta y falsa. `eevd_semanal`
  // nace con el primer módulo operativo (hito c) y el backlog con el motor de sync (hito e).
  const a = await agregadosDe(tenant.bd, ventanaDe(AHORA));
  assert.equal(a.eevd_semanal, null);
  assert.equal(a.backlog_sync_max_min, null);
});

test("[AC-FTEN-20] sin métricas en la ventana el porcentaje es NULL, no 0%", async () => {
  // «Cero errores» y «no se midió» son cosas distintas y el panel del §10 las pinta distinto.
  const vacia = ventanaDe(new Date("2026-01-01T00:00:00.000Z"));
  const a = await agregadosDe(tenant.bd, vacia);
  assert.equal(a.errores_sync_pct, null);
  assert.equal(a.dispositivos_activos, 0, "el conteo de distintos SÍ es cero: se contó y dio cero");
});

test("[AC-FTEN-20] el job produce la fila del tenant en `control`, con el schema fijo", async () => {
  const { empujados, omitidos } = await exportar({ ahora: AHORA });
  assert.ok(empujados.includes(SLUG), `el tenant no se exportó: ${JSON.stringify(omitidos)}`);

  const filas = await control.sql(
    "select * from agregados_tecnicos where tenant_id = $1",
    [idTenantEnControl],
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].usuarios_activos, 2);
  assert.equal(filas[0].dispositivos_activos, 2);
  assert.equal(filas[0].eevd_semanal, null);
  assert.equal(filas[0].backlog_sync_max_min, null);
});

test("[AC-FTEN-20] dos corridas del MISMO tramo actualizan la fila, no la duplican", async () => {
  await exportar({ ahora: AHORA });
  await exportar({ ahora: new Date(AHORA.getTime() + 90_000) });
  const [{ n }] = await control.sql(
    "select count(*)::int as n from agregados_tecnicos where tenant_id = $1",
    [idTenantEnControl],
  );
  assert.equal(n, 1, "el panel cross-tenant se llenaría de filas casi iguales");
});

test("[AC-FTEN-20] un tenant registrado cuya base no existe se NOMBRA, no se saltea callado", async () => {
  await control.sql("insert into tenants (slug, bd) values ('gate_export_fantasma', 't_gate_export_fantasma')");
  try {
    const { omitidos } = await exportar({ ahora: AHORA });
    assert.equal(omitidos.length, 1);
    assert.match(omitidos[0], /gate_export_fantasma/);
    assert.match(omitidos[0], /su base .* no existe/);
  } finally {
    await control.sql("delete from tenants where slug = 'gate_export_fantasma'");
  }
});

test("[AC-FTEN-20] un tenant NO activo no se exporta: `control` no inventa datos de un suspendido", async () => {
  await control.sql("update tenants set estado = 'suspendido' where slug = $1", [SLUG]);
  try {
    const { empujados } = await exportar({ ahora: AHORA });
    assert.ok(!empujados.includes(SLUG));
  } finally {
    await control.sql("update tenants set estado = 'activo' where slug = $1", [SLUG]);
  }
});
