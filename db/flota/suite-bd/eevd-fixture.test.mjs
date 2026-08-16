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
// ─── QUÉ CIERRA AC-FMIG-23, Y QUÉ SE PARTIÓ A AC-FMIG-28 ───────────────────────────────────
//
// El DENOMINADOR (vehículos-día con turno abierto, §2) es computable HOY: se aserta de verdad,
// contra la base, entra al gate y tiene su mutante vivo — eso es lo que AC-FMIG-23 cierra.
// El NUMERADOR (paradas `entrega` con `estado='done'`, resultado `exito|parcial` y ≥1 fila
// válida en `evidence`) se partió a [AC-FMIG-28] porque sigue BLOQUEADO por la Pregunta al dueño
// 4 de specs/flota/04-pod-offline-sync.md: el enum de `evidence` no tiene ningún tipo capturable
// en la entrega feliz de 2 acciones (§5.2 F4), así que HOY toda entrega del camino feliz queda
// fuera del numerador y el `entrega.con_evidencia` que la vista cuenta no existe en
// `EVENTOS_OPERACION` (ver `seeds/eevd-esperado.mjs`). Este archivo NO elige por cuenta propia
// qué fila de `evidence` escribe la entrega feliz: el test de la EEVD completa (numerador +
// `eevd`) queda escrito pero SALTADO (`skip`) hasta que se responda esa pregunta — un `skip` no
// falla el gate, así que la cláusula pendiente no entra a la parte que sí es gate hoy.
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
const SUMA_DENOMINADOR =
  "select coalesce(sum(vehiculos_dia), 0)::int as total from eevd_semanal";

const vehiculosDiaTotales = async (bd) => {
  const [fila] = await con(bd, ({ sql }) => sql(SUMA_DENOMINADOR));
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

/**
 * El CASO DE REBOTE del AC («discrepancia ⇒ gate rojo») como mutante VIVO, no como promesa.
 *
 * Sin esto, los dos tests de arriba serían verdes también si `eevd_semanal` devolviera siempre
 * el mismo número por un motivo equivocado —una vista que ignorara `turnos`, un `sum()` sobre
 * cero filas que `coalesce` convierte en el valor esperado por casualidad—: un oráculo que no
 * puede ponerse rojo no es un oráculo. Acá se planta UN vehículo-día de más y se verifica que
 * la comparación contra la memoria de cálculo lo DETECTA, y que al retirarlo vuelve a verde.
 *
 * El mutante entra dentro de una transacción que se revierte SIEMPRE: `turnos` es append-only
 * (§7.4) y esta suite comparte cluster con el resto del gate, así que la vuelta a verde no
 * puede depender de un `delete` — que además la tabla no admite.
 *
 * La fila plantada abre 30 días ATRÁS y cierra una hora después: cae en otra semana (otra fila
 * de `eevd_semanal`, y por eso la suma es sobre todas) y su `periodo` no solapa con el del
 * turno vivo del mismo vehículo, que llega al infinito mientras nadie lo cierre — sin eso el
 * EXCLUDE `turnos_sin_solape` rebotaría el mutante y el test pasaría sin haber mutado nada.
 */
const plantarUnVehiculoDiaDeMas = async (bd, esperado, nota) =>
  con(bd, async ({ sql }) => {
    const [{ total: antes }] = await sql(SUMA_DENOMINADOR);
    assert.equal(
      antes,
      esperado.denominador,
      `control negativo: sin mutante, ${bd} tiene que coincidir con la memoria de cálculo`,
    );

    await sql("begin");
    try {
      const plantadas = await sql(
        `insert into turnos (vehiculo_id, config_version_id, estado, abierto_en, cerrado_en)
           select t.vehiculo_id, t.config_version_id, 'cerrado',
                  now() - interval '30 days',
                  now() - interval '30 days' + interval '1 hour'
             from turnos t
            order by t.abierto_en
            limit 1
         returning id`,
      );
      assert.equal(
        plantadas.length,
        1,
        `el mutante tiene que ENTRAR de verdad en ${bd}; si la fila no entra, lo que sigue ` +
          "verifica el vacío",
      );

      const [{ total: conMutante }] = await sql(SUMA_DENOMINADOR);
      assert.equal(
        conMutante,
        esperado.denominador + 1,
        `${bd}: plantado un vehículo-día de más, eevd_semanal tiene que sumar ` +
          `${esperado.denominador + 1} — si sigue en ${esperado.denominador}, la vista no está ` +
          "leyendo `turnos` y la comparación de arriba no puede fallar nunca",
      );
      assert.notEqual(
        conMutante,
        esperado.denominador,
        `${bd}: la comparación contra la memoria de cálculo (${nota}) tiene que ponerse ROJA ` +
          "con el mutante puesto — eso es el «discrepancia ⇒ gate rojo» del AC",
      );
    } finally {
      await sql("rollback");
    }

    const [{ total: despues }] = await sql(SUMA_DENOMINADOR);
    assert.equal(
      despues,
      esperado.denominador,
      `${bd}: retirado el mutante, la vista tiene que volver a coincidir con la memoria`,
    );
  });

test(
  "[AC-FMIG-23] caso de rebote tenant A: un vehículo-día de más pone ROJA la comparación, y retirarlo la devuelve a verde",
  async () => {
    await plantarUnVehiculoDiaDeMas(
      a.bd,
      EEVD_ESPERADO_A,
      "1 vehículo-día: el turno del chofer de la mañana",
    );
  },
);

test(
  "[AC-FMIG-23] caso de rebote tenant B: un vehículo-día de más pone ROJA la comparación, y retirarlo la devuelve a verde",
  async () => {
    await plantarUnVehiculoDiaDeMas(
      b.bd,
      EEVD_ESPERADO_B,
      "2 vehículos-día: las rutas maestras norte y sur, un vehículo cada una",
    );
  },
);

test(
  "[AC-FMIG-28] NUMERADOR y valor `eevd` completos contra la memoria de cálculo",
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
