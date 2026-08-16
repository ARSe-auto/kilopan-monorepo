#!/usr/bin/env node
// Mutantes del orden y del centinela 13 [AC-FTEN-07].
//
// Las dos reglas del runner que se pueden equivocar en silencio son el ORDEN (el canario deja
// de ir primero y nadie lo nota hasta que una migración rompe datos reales) y el UMBRAL del
// centinela 13 (una sola base rezagada entre muchas al día). Las dos viven como funciones
// puras para poder ejercerlas en cada iteración; el recorrido real contra el cluster está en
// `db/flota/suite-bd/migrar.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ordenDeMigracion, basesRezagadas } from "./migrar.mjs";

test("[AC-FTEN-07] el canario va PRIMERO y la plantilla segunda, con tenants ya en el cluster", () => {
  assert.deepEqual(ordenDeMigracion(["t_beta", "t_canary", "t_alfa"]), [
    "t_canary",
    "tenant_template",
    "t_alfa",
    "t_beta",
  ]);
});

test("[AC-FTEN-07] el canario va primero AUNQUE todavía no exista en el cluster", () => {
  // El runner lo provisiona antes de recorrer; si el orden dependiera de que ya estuviera,
  // el primer deploy migraría tenants reales antes que a nadie.
  assert.deepEqual(ordenDeMigracion([]), ["t_canary", "tenant_template"]);
});

test("[AC-FTEN-07] el canario aparece UNA vez: estar en la lista viva no lo duplica", () => {
  const orden = ordenDeMigracion(["t_canary"]);
  assert.equal(orden.filter((b) => b === "t_canary").length, 1);
  assert.deepEqual(orden, ["t_canary", "tenant_template"]);
});

test("[AC-FTEN-07] CENTINELA 13: una sola base rezagada entre varias al día ⇒ motivo", () => {
  const motivos = basesRezagadas({
    esperada: "0002_paradas",
    bases: [
      { bd: "t_canary", version: "0002_paradas" },
      { bd: "tenant_template", version: "0002_paradas" },
      { bd: "t_alfa", version: "0002_paradas" },
      { bd: "t_beta", version: "0001_identidad" },
    ],
  });
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /t_beta/);
  assert.match(motivos[0], /0001_identidad/);
  assert.match(motivos[0], /el deploy NO es verde/);
});

test("[AC-FTEN-07] una base sin migrar del todo se nombra como tal, no como «undefined»", () => {
  const [motivo] = basesRezagadas({
    esperada: "0001_identidad",
    bases: [{ bd: "t_nueva", version: null }],
  });
  assert.match(motivo, /t_nueva está en \(sin migrar\)/);
});

test("[AC-FTEN-07] todas al día ⇒ cero motivos", () => {
  assert.deepEqual(
    basesRezagadas({
      esperada: "0001_identidad",
      bases: [
        { bd: "t_canary", version: "0001_identidad" },
        { bd: "tenant_template", version: "0001_identidad" },
      ],
    }),
    [],
  );
});

test("[AC-FTEN-07] una base ADELANTADA tampoco es «al día»: distinta de la esperada es rojo", () => {
  // Una BD con una migración que el repo no tiene es un parche a mano. Verde ahí sería
  // declarar bueno exactamente el estado que AC-FTEN-02 audita como rezago de la plantilla.
  const motivos = basesRezagadas({
    esperada: "0001_identidad",
    bases: [{ bd: "t_alfa", version: "0002_a_mano" }],
  });
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /t_alfa está en 0002_a_mano/);
});

test("[AC-FTEN-07] sin migraciones en disco no hay veredicto: cero motivos, y es por vacío", () => {
  assert.deepEqual(basesRezagadas({ esperada: null, bases: [{ bd: "t_alfa", version: null }] }), []);
});
