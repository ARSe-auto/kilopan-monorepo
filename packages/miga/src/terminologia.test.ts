import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolverTermino,
  resolverTerminologiaCompleta,
  TERMINOLOGIA_BASE_ES_CL,
} from "./terminologia.ts";
import { LABELS } from "../../nucleo-comun/src/constants.ts";

// AC-FMIG-04 — capa de copy con resolución `term_key`: tenant → vertical → base es-CL (§5.1).
// Este archivo prueba la cadena de resolución pura; la lectura real de `tenant_terminology`
// (AC-FTEN-10) la ejerce el e2e contra la base — es la BD quien tiene la última palabra sobre
// qué fila existe, acá solo se prueba QUÉ GANA cuando existe.

// ─── Sin overrides: la base es-CL es lo único que nunca falta ────────────────────────────

test("sin overrides de ningún nivel, resuelve a la base es-CL [AC-FMIG-04]", () => {
  const r = resolverTermino({ termKey: "parada" });
  assert.equal(r.singular, "parada");
  assert.equal(r.plural, "paradas");
  assert.equal(r.canonico, "parada");
  assert.equal(r.tipo, "navegacion");
});

test("un term_key que no está en el catálogo rebota [AC-FMIG-04]", () => {
  assert.throws(() => resolverTermino({ termKey: "no_existe" }), /term_key desconocido/);
});

// ─── La cadena: tenant gana sobre vertical, vertical gana sobre base ─────────────────────

test("un override de TENANT gana sobre la base [AC-FMIG-04]", () => {
  const r = resolverTermino({
    termKey: "parada",
    overridesTenant: { parada: { singular: "Punto extra", plural: "Puntos extra" } },
  });
  assert.equal(r.singular, "Punto extra");
  assert.equal(r.plural, "Puntos extra");
});

test("sin fila de tenant para ESE term_key, otros term_keys del mismo tenant siguen en base — la cadena resuelve por clave, no por tenant entero [AC-FMIG-04]", () => {
  const overridesTenant = { parada: { singular: "Punto extra", plural: "Puntos extra" } };
  const parada = resolverTermino({ termKey: "parada", overridesTenant });
  const ruta = resolverTermino({ termKey: "ruta", overridesTenant });
  assert.equal(parada.singular, "Punto extra");
  assert.equal(ruta.singular, "ruta");
  assert.equal(ruta.plural, "rutas");
});

// ─── El canónico es SIEMPRE la base, jamás el nivel que ganó (§5.1: «entre paréntesis») ──

test("el canónico que ve el admin es la base, incluso con override de tenant [AC-FMIG-04]", () => {
  const r = resolverTermino({
    termKey: "excepcion",
    overridesTenant: { excepcion: { singular: "incidencia operativa", plural: "incidencias operativas" } },
  });
  assert.equal(r.canonico, "excepción");
  assert.notEqual(r.canonico, r.singular);
});

// ─── resolverTerminologiaCompleta: el catálogo entero, una vez por term_key ──────────────

test("resolverTerminologiaCompleta trae exactamente los term_key del catálogo base [AC-FMIG-04]", () => {
  const completa = resolverTerminologiaCompleta({});
  assert.deepEqual(Object.keys(completa).sort(), Object.keys(TERMINOLOGIA_BASE_ES_CL).sort());
});

test("resolverTerminologiaCompleta aplica overrides SOLO al term_key que corresponde [AC-FMIG-04]", () => {
  const completa = resolverTerminologiaCompleta({
    overridesTenant: { parada: { singular: "Punto extra", plural: "Puntos extra" } },
  });
  assert.equal(completa.parada!.singular, "Punto extra");
  assert.equal(completa.ruta!.singular, "ruta");
});

// ─── El catálogo base en sí respeta los largos por tipo — el mismo CHECK que AC-FTEN-10 ──
// aplicaría si alguien lo insertara como fila; acá se prueba porque nada más lo hace: la BASE
// no pasa por `tenant_terminology`, así que su propio CHECK de largo nunca la toca.

test("cada término de la base respeta LABELS.largo_max de su propio tipo [AC-FMIG-04]", () => {
  for (const [termKey, def] of Object.entries(TERMINOLOGIA_BASE_ES_CL)) {
    const max = LABELS.largo_max[def.tipo];
    assert.ok(def.singular.length <= max, `${termKey}.singular (${def.singular.length}) excede ${def.tipo}=${max}`);
    assert.ok(def.plural.length <= max, `${termKey}.plural (${def.plural.length}) excede ${def.tipo}=${max}`);
  }
});
