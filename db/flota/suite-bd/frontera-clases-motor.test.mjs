#!/usr/bin/env node
// La frontera de clases del MOTOR de sync [AC-FPOD-20] — §4.2, §0 HTTP.
//
// El endpoint real (`apps/flota/src/app/api/sync/capturas/route.ts`) solo aterriza dos tipos de
// captura hoy (POD y cierre de recarga), ambos hardcodeados a sus propias tablas CAPTURA — no
// hay ningún vector de producción que le mande una tabla PLANIFICACIÓN por ese camino. Por eso
// el AC pide una mutación SINTÉTICA: ejercer la misma guardia que el endpoint llama
// (`exigirClaseCaptura`, de `servidor/clasificacion-tablas.ts`) contra una tabla PLANIFICACIÓN
// real — el vehículo sugerido por el propio AC es el solape de agenda del centinela 5 (§9.3):
// `turnos` (AC-FVEH-06) y `bloques_agenda` (AC-FVEH-07), las dos ya cerradas y con su propio 422
// en SU camino online. La prueba es que el MOTOR, si alguna vez algo intentara colarles una
// mutación por el camino de sync en vez del suyo, la rebota tipada ANTES de escribir una fila —
// nunca el 2xx-siempre que la regla de oro reserva para CAPTURA.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar, desalta } from "../provisionar.mjs";
import { con, conectar, bdDeTenant } from "../conectar.mjs";
import { exigirClaseCaptura } from "../../../apps/flota/src/servidor/clasificacion-tablas.ts";

const SLUG = "gate_frontera";
let tenant;
let app;

async function limpiar() {
  // Complemento del alta en `control.tenants` [AC-FPOR-01]: sin esto, la fila sobrevive al
  // DROP DATABASE y el job exportador la reporta huérfana en la corrida siguiente.
  await desalta(SLUG);
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`));
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
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await limpiar();
});

test("[AC-FPOD-20] mutación sintética sobre `turnos` (PLANIFICACIÓN) por el camino de sync ⇒ fuera de clase, 0 filas", async () => {
  const [{ n: antes }] = await app.sql("select count(*)::int as n from turnos");

  const veredicto = await exigirClaseCaptura(app.cliente, "turnos");
  assert.deepEqual(veredicto, { tipo: "fuera_de_clase", tabla: "turnos", clase: "PLANIFICACION" });

  const [{ n: despues }] = await app.sql("select count(*)::int as n from turnos");
  assert.equal(despues, antes, "el motor escribió algo antes de rebotar — la guardia no corrió primero");
});

test("[AC-FPOD-20] mutación sintética sobre `bloques_agenda` (PLANIFICACIÓN, centinela 5 §9.3) ⇒ fuera de clase, 0 filas", async () => {
  const [{ n: antes }] = await app.sql("select count(*)::int as n from bloques_agenda");

  const veredicto = await exigirClaseCaptura(app.cliente, "bloques_agenda");
  assert.deepEqual(veredicto, {
    tipo: "fuera_de_clase",
    tabla: "bloques_agenda",
    clase: "PLANIFICACION",
  });

  const [{ n: despues }] = await app.sql("select count(*)::int as n from bloques_agenda");
  assert.equal(despues, antes);
});

test("[AC-FPOD-20] `eventos` — el aterrizaje universal de toda CAPTURA (§4.6) — pasa la guardia", async () => {
  // El control: si la guardia rechazara cualquier tabla sin distinción, la suite de arriba
  // pasaría por la razón equivocada. `eventos` es la tabla que el endpoint real chequea en cada
  // llamada (route.ts).
  const veredicto = await exigirClaseCaptura(app.cliente, "eventos");
  assert.deepEqual(veredicto, { tipo: "ok" });
});

test("[AC-FPOD-20] tabla inexistente ⇒ el `regclass` rebota, jamás se trata como CAPTURA por defecto", async () => {
  await assert.rejects(() => exigirClaseCaptura(app.cliente, "tabla_que_no_existe_nunca"));
});
