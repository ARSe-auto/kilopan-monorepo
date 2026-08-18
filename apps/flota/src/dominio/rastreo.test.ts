import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDeRastreo } from "./rastreo.ts";

// [AC-FTEL-01] §7.8: el texto que el chofer ve, y el ÚNICO motivo por el que cambia es si el
// turno está abierto — nunca una preferencia del tenant.

test("[AC-FTEL-01] con turno abierto: rastreando, con la hora de apertura", () => {
  const resultado = estadoDeRastreo("2026-08-18T10:05:00-04:00");
  assert.equal(resultado.rastreando, true);
  assert.match(resultado.texto, /^En ruta, rastreado desde \d{2}:\d{2}$/);
});

test("[AC-FTEL-01] sin turno abierto: rastreo apagado, texto fijo", () => {
  assert.deepEqual(estadoDeRastreo(null), { rastreando: false, texto: "Rastreo apagado" });
});
