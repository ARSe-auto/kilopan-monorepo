#!/usr/bin/env node
// Paso 1 del wizard de onboarding, contra el cluster real [AC-FMIG-14].
//
// La siembra de `vertical_template` solo se puede probar con Postgres de verdad al otro lado
// (el CHECK `meta_eevd > 0`, el `unique (tenant_id, vertical)`): por eso vive acá y corre con
// `--full`, igual que `provisionar.test.mjs`, del que este archivo es vecino directo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con, bdDeTenant } from "../conectar.mjs";
import { pasoUnoEmpresaYVertical, VERTICALES_DEMO } from "../wizard-onboarding.mjs";
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
