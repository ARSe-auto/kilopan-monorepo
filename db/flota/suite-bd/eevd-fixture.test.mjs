#!/usr/bin/env node
// Test de fixture de la EEVD del DONE-software [AC-FMIG-23] —
// specs/flota/08-diseno-miga-onboarding.md §7, §10 del maestro.
//
// El valor esperado va HARDCODEADO en `seeds/eevd-esperado.mjs` (memoria de cálculo versionada
// junto a los seeds A/B, AC-FMIG-27: numerador, denominador y la fila exacta de cada seed que
// los produce) y este archivo lo COMPARA contra `eevd_semanal` (migración 0020, AC-FVEH-20) real,
// sembrada desde `tenant_template` — jamás recalculándolo, porque un test que recalcula está
// comparando la vista contra sí misma.
//
// ─── QUÉ ENTRA AL GATE HOY, Y QUÉ NO (IMPLEMENTATION_PLAN_flota.md: «AC-FMIG-23 — numerador
//      fuera del gate hasta la respuesta») ──────────────────────────────────────────────────
//
// El DENOMINADOR (vehículos-día con turno abierto, §2) es computable HOY: se aserta de verdad,
// contra la base, y entra al gate. El NUMERADOR (paradas `entrega` con `estado='done'`, resultado
// `exito|parcial` y ≥1 fila válida en `evidence`) queda BLOQUEADO por la Pregunta al dueño 4 de
// specs/flota/04-pod-offline-sync.md: el enum de `evidence` no tiene ningún tipo capturable en la
// entrega feliz de 2 acciones (§5.2 F4), así que HOY toda entrega del camino feliz queda fuera
// del numerador y el `entrega.con_evidencia` que la vista cuenta no existe en `EVENTOS_OPERACION`
// (ver `seeds/eevd-esperado.mjs`). Este archivo NO elige por cuenta propia qué fila de `evidence`
// escribe la entrega feliz: el test de la EEVD completa (numerador + `eevd`) queda escrito pero
// SALTADO (`skip`) hasta que se responda esa pregunta — un `skip` no falla el gate, así que la
// cláusula pendiente no entra a la parte que sí es gate hoy.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con } from "../conectar.mjs";
import { sembrarTenantA } from "../seeds/tenant-a.mjs";
import { sembrarTenantB } from "../seeds/tenant-b.mjs";
import { EEVD_ESPERADO_A, EEVD_ESPERADO_B } from "../seeds/eevd-esperado.mjs";

const SLUG_A = "gate_eevd_a";
const SLUG_B = "gate_eevd_b";
let a, b;

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  // Secuencial y no en paralelo: las dos provisiones parten de `CREATE DATABASE … TEMPLATE
  // tenant_template`, que exige acceso exclusivo a la plantilla (mismo motivo que
  // `seeds-fila-cruzada.test.mjs` y por el que `gate.sh` corre esta suite con
  // `--test-concurrency=1`).
  a = await sembrarTenantA(SLUG_A, { recrear: true });
  b = await sembrarTenantB(SLUG_B, { recrear: true });
});

/**
 * Suma de `vehiculos_dia` sobre TODAS las filas de `eevd_semanal`, sin filtrar por semana: la
 * corrida real abre los turnos en el instante en que corre el seed (no en una fecha de guion,
 * `seeds/eevd-esperado.mjs`), así que lo único que la memoria de cálculo congela es la CANTIDAD
 * de vehículos-día que deja, sea cual sea la semana en que caiga.
 */
const vehiculosDiaTotales = async (bd) => {
  const [fila] = await con(bd, ({ sql }) =>
    sql("select coalesce(sum(vehiculos_dia), 0)::int as total from eevd_semanal"),
  );
  return fila.total;
};

test(
  "[AC-FMIG-23] tenant A: el DENOMINADOR real de eevd_semanal coincide con la memoria de cálculo de AC-FMIG-27",
  async () => {
    const total = await vehiculosDiaTotales(a.bd);
    assert.equal(
      total,
      EEVD_ESPERADO_A.denominador,
      `eevd_semanal sumó ${total} vehículos-día en ${a.bd}; la memoria de cálculo ` +
        `(seeds/eevd-esperado.mjs) esperaba ${EEVD_ESPERADO_A.denominador} — el turno del ` +
        "chofer de la mañana sobre `vehiculos[0]` de `tenant-a.mjs`.",
    );
  },
);

test(
  "[AC-FMIG-23] tenant B: el DENOMINADOR real de eevd_semanal coincide con la memoria de cálculo de AC-FMIG-27",
  async () => {
    const total = await vehiculosDiaTotales(b.bd);
    assert.equal(
      total,
      EEVD_ESPERADO_B.denominador,
      `eevd_semanal sumó ${total} vehículos-día en ${b.bd}; la memoria de cálculo ` +
        `(seeds/eevd-esperado.mjs) esperaba ${EEVD_ESPERADO_B.denominador} — las dos rutas ` +
        "maestras de `tenant-b-operacion.mjs`, cada una con su propio vehículo.",
    );
  },
);

test(
  "[AC-FMIG-23] NUMERADOR y valor `eevd` completos contra la memoria de cálculo",
  {
    skip:
      "BLOQUEADO por la Pregunta al dueño 4 de specs/flota/04-pod-offline-sync.md: el enum de " +
      "`evidence` no tiene ningún tipo capturable en la entrega feliz de 2 acciones (§5.2 F4), " +
      "así que `entrega.con_evidencia` no existe todavía en EVENTOS_OPERACION y el numerador de " +
      "AMBOS tenants es 0 por ausencia de catálogo, no por una elección de este test. Quitar " +
      "este `skip` en el mismo commit que responda la Pregunta 4 y haga emitir el evento.",
  },
  async () => {
    for (const [tenant, esperado] of [
      ["a", EEVD_ESPERADO_A],
      ["b", EEVD_ESPERADO_B],
    ]) {
      const bd = tenant === "a" ? a.bd : b.bd;
      const filas = await con(bd, ({ sql }) =>
        sql("select entregas_con_evidencia::int as numerador, eevd from eevd_semanal"),
      );
      const numerador = filas.reduce((acc, f) => acc + f.numerador, 0);
      assert.equal(numerador, esperado.numerador, `tenant ${tenant}: numerador`);
      assert.deepEqual(
        filas.map((f) => f.eevd),
        filas.length ? [esperado.eevd] : [],
        `tenant ${tenant}: eevd`,
      );
    }
  },
);
