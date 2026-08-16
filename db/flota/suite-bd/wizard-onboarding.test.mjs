#!/usr/bin/env node
// Paso 1 del wizard de onboarding, contra el cluster real [AC-FMIG-14].
//
// La siembra de `vertical_template` solo se puede probar con Postgres de verdad al otro lado
// (el CHECK `meta_eevd > 0`, el `unique (tenant_id, vertical)`): por eso vive acá y corre con
// `--full`, igual que `provisionar.test.mjs`, del que este archivo es vecino directo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con, bdDeTenant, BD_PLANTILLA } from "../conectar.mjs";
import { pasoUnoEmpresaYVertical, VERTICALES_DEMO, completo } from "../wizard-onboarding.mjs";
import { desregistrar } from "./desregistrar.mjs";

const SLUG = "gate_wizard";

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
});

test("[AC-FMIG-14] paso 1 provisiona el tenant y siembra la fila completa del vertical elegido", async () => {
  const inicio = process.hrtime.bigint();
  const r = await pasoUnoEmpresaYVertical(SLUG, { vertical: "panaderia", modo: "daas", recrear: true });
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;

  assert.equal(r.bd, bdDeTenant(SLUG));
  assert.equal(r.vertical, "panaderia");
  assert.equal(r.modo, "daas");
  // El §4.1 dice «CREATE DATABASE … TEMPLATE — segundos, dentro del wizard»: 60 s ya es un
  // orden de magnitud por encima de «segundos» y detecta una regresión real sin ser frágil
  // contra una máquina lenta — el AC completo (los 4 pasos) tiene el techo de 15 min, no este.
  assert.ok(ms < 60_000, `el paso 1 tardó ${ms.toFixed(0)} ms — se esperaban segundos, no ${(ms / 1000).toFixed(1)} s`);

  const [fila] = await con(r.bd, ({ sql }) =>
    sql(
      `select vertical, terminologia, motivos, checklists, cargo_types, config_ev, meta_eevd::float as meta_eevd
         from vertical_template where vertical = $1`,
      ["panaderia"],
    ),
  );
  assert.ok(fila, "la fila de vertical_template no quedó sembrada");
  assert.deepEqual(fila.terminologia, VERTICALES_DEMO.panaderia.terminologia);
  assert.deepEqual(fila.motivos.sort(), [...VERTICALES_DEMO.panaderia.motivos].sort());
  assert.deepEqual(fila.checklists, VERTICALES_DEMO.panaderia.checklists);
  assert.deepEqual(fila.cargo_types.sort(), [...VERTICALES_DEMO.panaderia.cargo_types].sort());
  assert.deepEqual(fila.config_ev, VERTICALES_DEMO.panaderia.config_ev);
  assert.equal(fila.meta_eevd, VERTICALES_DEMO.panaderia.meta_eevd);
});

test("[AC-FMIG-14] caso de rebote: vertical fuera del catálogo E1 no crea ninguna base", async () => {
  const slugRebote = "gate_wizard_rebote";
  await con("postgres", ({ sql }) =>
    sql(`drop database if exists ${bdDeTenant(slugRebote)} with (force)`),
  );
  await desregistrar(slugRebote);

  await assert.rejects(
    () => pasoUnoEmpresaYVertical(slugRebote, { vertical: "vertical_inexistente" }),
    /vertical inválido/,
  );

  const [{ existe }] = await con("postgres", ({ sql }) =>
    sql("select exists(select 1 from pg_database where datname = $1) as existe", [bdDeTenant(slugRebote)]),
  );
  assert.equal(existe, false, "un vertical inválido no puede dejar una base a medio provisionar");
});

test("[AC-FMIG-15] activar el vertical panadería = INSERT de filas: schema_migrations queda IDÉNTICO al de tenant_template", async () => {
  // §2 métrica 4: «activar un vertical = INSERT de filas, cero migraciones». El «antes» es
  // `tenant_template` —el origen del que `CREATE DATABASE … TEMPLATE` copia— y el «después» es
  // el tenant recién nacido tras el paso 1 completo (provisión + siembra de `vertical_template`).
  // Si activar el vertical hubiera ejecutado —o dejado pendiente— una sola migración de más,
  // las dos listas dejarían de coincidir.
  const filasPlantilla = await con(BD_PLANTILLA, ({ sql }) =>
    sql("select version, sha256 from schema_migrations order by version"),
  );
  assert.ok(filasPlantilla.length > 0, "tenant_template no tiene schema_migrations — nada que comparar");

  const r = await pasoUnoEmpresaYVertical(`${SLUG}_activar`, {
    vertical: "panaderia",
    modo: "daas",
    recrear: true,
  });
  const filasTenant = await con(r.bd, ({ sql }) =>
    sql("select version, sha256 from schema_migrations order by version"),
  );

  assert.deepEqual(
    filasTenant,
    filasPlantilla,
    "activar el vertical panadería tocó schema_migrations: dejó de ser un INSERT puro (§2 métrica 4)",
  );

  // El positivo, para que el before/after no sea vacuo: la fila del vertical SÍ quedó sembrada.
  const [fila] = await con(r.bd, ({ sql }) =>
    sql("select vertical from vertical_template where vertical = $1", ["panaderia"]),
  );
  assert.ok(fila, "el vertical no quedó sembrado — el before/after sería trivialmente idéntico");
});

test("[AC-FMIG-14] wizard completo: los 4 pasos de punta a punta, bajo el techo de 15 min del §3.E1.13", async () => {
  const r = await completo(`${SLUG}_completo`, { vertical: "panaderia", modo: "mi_flota", recrear: true });

  assert.equal(r.bd, bdDeTenant(`${SLUG}_completo`));
  assert.ok(r.vehiculo?.id, "paso 2 no dejó vehículo");
  assert.ok(r.chofer?.usuarioId, "paso 2 no dejó chofer aprobado");
  assert.ok(r.encargo?.id, "paso 3 no dejó encargo");
  assert.ok(r.parada?.id, "paso 3 no dejó parada publicada");
  assert.equal(r.primeraParadaCompletada, true, "paso 4 no completó la primera parada");
  assert.equal(r.resultadoDeLaPrimeraParada, "exito");
  assert.ok(
    r.ms < 15 * 60 * 1000,
    `el wizard completo tardó ${(r.ms / 1000).toFixed(1)} s — el §3.E1.13 exige <15 min`,
  );
});
