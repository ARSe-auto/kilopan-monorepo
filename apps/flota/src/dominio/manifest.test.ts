import test from "node:test";
import assert from "node:assert/strict";
import { modulosNavegables, entitlementsDeModo, MODULOS_SIEMPRE, MODULOS_GRUPO_DAAS } from "./manifest.ts";

// Manifest de módulos contraído por modo [AC-FPOR-03] — spec 07 §1, §2.

test("mi_flota: el manifest trae SOLO lo operativo — el grupo DaaS no aparece", () => {
  const modulos = modulosNavegables(entitlementsDeModo("mi_flota"));
  assert.deepEqual(
    modulos.map((m) => m.clave),
    MODULOS_SIEMPRE.map((m) => m.clave),
  );
});

test("daas: el manifest trae lo operativo MÁS el grupo DaaS completo", () => {
  const modulos = modulosNavegables(entitlementsDeModo("daas"));
  assert.equal(modulos.length, MODULOS_SIEMPRE.length + MODULOS_GRUPO_DAAS.length);
  for (const m of MODULOS_GRUPO_DAAS) {
    assert.ok(modulos.some((x) => x.clave === m.clave), `faltó «${m.clave}» en daas`);
  }
});

test("una feature del grupo DaaS sin entrada en el mapa cuenta como apagada, no como encendida por defecto", () => {
  // Mismo criterio que `entitlementVigente`/`dominioSemaforoActivo`: `undefined` no es `true`.
  const modulos = modulosNavegables({});
  assert.deepEqual(
    modulos.map((m) => m.clave),
    MODULOS_SIEMPRE.map((m) => m.clave),
  );
});

test("una feature del grupo DaaS explícitamente false tampoco aparece", () => {
  const modulos = modulosNavegables({
    tarifas: false,
    liquidacion_por_cliente: false,
    portal_contratante: false,
    facturacion: false,
  });
  assert.equal(modulos.length, MODULOS_SIEMPRE.length);
});

test("cada feature del grupo DaaS se evalúa independiente — encender una sola no arrastra las otras", () => {
  const modulos = modulosNavegables({ tarifas: true });
  assert.deepEqual(
    modulos.map((m) => m.clave),
    [...MODULOS_SIEMPRE.map((m) => m.clave), "tarifas"],
  );
});
