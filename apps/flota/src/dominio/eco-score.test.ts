import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEcoScoreSemanal, AVISO_ECO_SCORE, type FilaEcoScore } from "./eco-score.ts";

// [AC-FTEL-08] Eco-score v1 sin hardware — §11 punto 6.

function fila(parcial: Partial<FilaEcoScore> = {}): FilaEcoScore {
  return {
    choferId: "chofer-1",
    choferNombre: "Ana Pérez",
    semana: "2026-08-17",
    kmPresupuestoEnergia: 100,
    kmRecorridos: 80,
    ...parcial,
  };
}

test("consumo declarado vs presupuesto: dos rutas de la misma semana se suman antes de dividir", () => {
  const resultado = calcularEcoScoreSemanal([
    fila({ kmPresupuestoEnergia: 100, kmRecorridos: 80 }),
    fila({ kmPresupuestoEnergia: 50, kmRecorridos: 40 }),
  ]);
  assert.equal(resultado.length, 1);
  const [r] = resultado;
  assert.equal(r!.tipo, "ok");
  assert.deepEqual(r, {
    tipo: "ok",
    choferId: "chofer-1",
    choferNombre: "Ana Pérez",
    semana: "2026-08-17",
    kmRecorridos: 120,
    kmPresupuestoEnergia: 150,
    consumoPct: 80,
    rutasConsideradas: 2,
  });
});

test("división por cero (sin rutas con presupuesto) ⇒ estado vacío, jamás un score inventado", () => {
  const resultado = calcularEcoScoreSemanal([
    fila({ kmPresupuestoEnergia: null, kmRecorridos: 80 }),
    fila({ kmPresupuestoEnergia: 0, kmRecorridos: 40 }),
  ]);
  assert.equal(resultado.length, 1);
  assert.deepEqual(resultado[0], {
    tipo: "vacio",
    choferId: "chofer-1",
    choferNombre: "Ana Pérez",
    semana: "2026-08-17",
  });
});

test("rutas sin presupuesto se descuentan del cálculo, no entran como cero", () => {
  const resultado = calcularEcoScoreSemanal([
    fila({ kmPresupuestoEnergia: 100, kmRecorridos: 100 }),
    fila({ kmPresupuestoEnergia: null, kmRecorridos: 999 }),
  ]);
  assert.equal(resultado.length, 1);
  const r = resultado[0]!;
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") {
    assert.equal(r.rutasConsideradas, 1);
    assert.equal(r.kmRecorridos, 100);
    assert.equal(r.consumoPct, 100);
  }
});

test("un chofer que no manejó nada esa semana da 0%, no es división por cero", () => {
  const resultado = calcularEcoScoreSemanal([fila({ kmPresupuestoEnergia: 100, kmRecorridos: 0 })]);
  assert.equal(resultado.length, 1);
  const r = resultado[0]!;
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") assert.equal(r.consumoPct, 0);
});

test("agrupa por chofer Y por semana — nunca mezcla choferes ni semanas distintas", () => {
  const resultado = calcularEcoScoreSemanal([
    fila({ choferId: "chofer-1", semana: "2026-08-17", kmPresupuestoEnergia: 100, kmRecorridos: 50 }),
    fila({ choferId: "chofer-2", semana: "2026-08-17", kmPresupuestoEnergia: 100, kmRecorridos: 90 }),
    fila({ choferId: "chofer-1", semana: "2026-08-24", kmPresupuestoEnergia: 100, kmRecorridos: 100 }),
  ]);
  assert.equal(resultado.length, 3);
  const porClave = new Map(resultado.map((r) => [`${r.choferId}|${r.semana}`, r]));
  const c1s1 = porClave.get("chofer-1|2026-08-17");
  const c2s1 = porClave.get("chofer-2|2026-08-17");
  const c1s2 = porClave.get("chofer-1|2026-08-24");
  assert.ok(c1s1?.tipo === "ok" && c1s1.consumoPct === 50);
  assert.ok(c2s1?.tipo === "ok" && c2s1.consumoPct === 90);
  assert.ok(c1s2?.tipo === "ok" && c1s2.consumoPct === 100);
});

test("consumo puede superar el 100% del presupuesto — se muestra literal, sin techo inventado", () => {
  const resultado = calcularEcoScoreSemanal([fila({ kmPresupuestoEnergia: 100, kmRecorridos: 150 })]);
  const r = resultado[0]!;
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") assert.equal(r.consumoPct, 150);
});

test("el aviso de la pantalla nombra qué mide y aclara que no es tiempo real (AC-FTEL-08)", () => {
  assert.match(AVISO_ECO_SCORE, /DECLARADA/);
  assert.match(AVISO_ECO_SCORE, /NO es una medición de manejo en tiempo real/);
});
