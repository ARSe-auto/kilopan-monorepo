import test from "node:test";
import assert from "node:assert/strict";
import { transicionColor, type UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Histéresis por señal [AC-FSEM-02] — spec 05 §2.4: secuencia disparo→zona intermedia
// (sigue en el color de alarma)→recuperación (verde), y la misma mecánica para rojo→amarillo.
// El CHECK de `signal_rule.umbral_recuperacion` DISTINTO del de disparo es DDL sobre una
// tabla que el módulo 00 todavía no siembra (AGENTS.md: el motor no toca `db/migraciones/`)
// — ese oráculo queda pendiente de sesión supervisada; este archivo prueba solo la mecánica
// de transición, que sí es construible hoy.

const umbrales: UmbralesHisteresis = { umbral_amarillo: 30, umbral_rojo: 60, umbral_recuperacion: 20 };

test("cruza umbral_amarillo ⇒ amarillo", () => {
  assert.equal(transicionColor("verde", 35, umbrales), "amarillo");
});

test("retrocede a zona intermedia (entre recuperación y disparo) ⇒ SIGUE amarillo", () => {
  assert.equal(transicionColor("amarillo", 25, umbrales), "amarillo");
});

test("cruza umbral_recuperacion ⇒ verde", () => {
  assert.equal(transicionColor("amarillo", 15, umbrales), "verde");
});

test("zona intermedia sin haber disparado nunca ⇒ se queda en verde (no alarma sola)", () => {
  assert.equal(transicionColor("verde", 25, umbrales), "verde");
});

test("cruza umbral_rojo ⇒ rojo", () => {
  assert.equal(transicionColor("amarillo", 65, umbrales), "rojo");
});

test("misma mecánica para rojo→amarillo: baja del umbral_rojo pero sigue sobre umbral_amarillo ⇒ amarillo", () => {
  assert.equal(transicionColor("rojo", 45, umbrales), "amarillo");
});

test("misma mecánica para rojo→amarillo: rojo cae directo a zona intermedia ⇒ amarillo, no verde ni rojo", () => {
  assert.equal(transicionColor("rojo", 25, umbrales), "amarillo");
});

test("rojo en zona intermedia sigue exigiendo cruzar recuperación para llegar a verde", () => {
  assert.equal(transicionColor("amarillo", 15, umbrales), "verde");
});

test("secuencia completa disparo→zona intermedia→recuperación, paso a paso", () => {
  let color = transicionColor("verde", 10, umbrales);
  assert.equal(color, "verde");
  color = transicionColor(color, 35, umbrales); // dispara amarillo
  assert.equal(color, "amarillo");
  color = transicionColor(color, 25, umbrales); // zona intermedia: sigue amarillo
  assert.equal(color, "amarillo");
  color = transicionColor(color, 65, umbrales); // escala a rojo
  assert.equal(color, "rojo");
  color = transicionColor(color, 45, umbrales); // baja del rojo, sigue sobre amarillo
  assert.equal(color, "amarillo");
  color = transicionColor(color, 25, umbrales); // zona intermedia: sigue amarillo (no rojo, no verde)
  assert.equal(color, "amarillo");
  color = transicionColor(color, 15, umbrales); // cruza recuperación
  assert.equal(color, "verde");
});
