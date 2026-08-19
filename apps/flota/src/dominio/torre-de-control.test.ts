import { test } from "node:test";
import assert from "node:assert/strict";
import { antiguedadDePosicion } from "./torre-de-control.ts";
import { RASTREO } from "../../../../packages/nucleo-comun/src/constants.ts";

// [AC-FTEL-04] La antigüedad honesta que ve el gestor — §5.7, §11.

test("recién aterrizada: no está desactualizada y lo dice sin inventar minutos", () => {
  const ahora = new Date("2026-08-18T12:00:00.000Z");
  const r = antiguedadDePosicion("2026-08-18T11:59:40.000Z", ahora);
  assert.equal(r.minutos, 0);
  assert.equal(r.texto, "hace instantes");
  assert.equal(r.desactualizada, false);
});

test("dos minutos: el texto es el literal del AC", () => {
  const ahora = new Date("2026-08-18T12:00:00.000Z");
  const r = antiguedadDePosicion("2026-08-18T11:58:00.000Z", ahora);
  assert.equal(r.minutos, 2);
  assert.equal(r.texto, "hace 2 min");
  assert.equal(r.desactualizada, false);
});

test("exactamente el umbral: todavía NO es desactualizada — el AC pide MÁS de 10 min", () => {
  const ahora = new Date("2026-08-18T12:00:00.000Z");
  const recibidaEn = new Date(
    ahora.getTime() - RASTREO.umbral_desactualizada_min * 60_000,
  ).toISOString();
  const r = antiguedadDePosicion(recibidaEn, ahora);
  assert.equal(r.minutos, RASTREO.umbral_desactualizada_min);
  assert.equal(r.desactualizada, false);
});

test("un segundo pasado el umbral: ahí sí es desactualizada, aunque el minuto redondeado no lo delate", () => {
  const ahora = new Date("2026-08-18T12:00:00.000Z");
  const recibidaEn = new Date(
    ahora.getTime() - (RASTREO.umbral_desactualizada_min * 60_000 + 1_000),
  ).toISOString();
  const r = antiguedadDePosicion(recibidaEn, ahora);
  assert.equal(r.desactualizada, true);
});

test("cuarenta minutos: el texto del AC ('hace 40 min') y marcada desactualizada", () => {
  const ahora = new Date("2026-08-18T12:00:00.000Z");
  const r = antiguedadDePosicion("2026-08-18T11:20:00.000Z", ahora);
  assert.equal(r.texto, "hace 40 min");
  assert.equal(r.desactualizada, true);
});

test("un reloj de teléfono adelantado no puede hacer una posición vieja parecer fresca", () => {
  // `recibidaEn` (servidor) es de hace 40 min; nada en la firma de la función permite que un
  // `capturada_en` distinto —el reloj del aparato— cambie el resultado, porque ni siquiera se
  // recibe como parámetro. Es la prueba de que el doble reloj se resolvió del lado correcto.
  const ahora = new Date("2026-08-18T12:00:00.000Z");
  const r = antiguedadDePosicion("2026-08-18T11:20:00.000Z", ahora);
  assert.equal(r.desactualizada, true);
});
