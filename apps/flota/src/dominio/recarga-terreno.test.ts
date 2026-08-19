import { test } from "node:test";
import assert from "node:assert/strict";
import { cerrarCarga, iniciarCarga, whDesdeKwh } from "./recarga-terreno.ts";

// [AC-FPOD-13] — el estado de terreno de la recarga: «Iniciar carga» (1 toque, sin validación
// posible) y `cerrarCarga`, donde el teclado se convierte en la captura que el outbox guarda.

test("whDesdeKwh convierte kWh decimales a Wh enteros (§0)", () => {
  assert.equal(whDesdeKwh(20), 20_000);
  assert.equal(whDesdeKwh(1.5), 1_500);
});

test("whDesdeKwh redondea en vez de truncar", () => {
  assert.equal(whDesdeKwh(0.1234), 123);
});

test("iniciarCarga marca la sesión iniciada con el vehículo y el turno de la parada", () => {
  const sesion = iniciarCarga("veh-1", "turno-1");
  assert.deepEqual(sesion, { vehiculoId: "veh-1", turnoId: "turno-1", iniciada: true });
});

test("iniciarCarga acepta turno null: la captura juzga contra la config vigente", () => {
  assert.equal(iniciarCarga("veh-1", null).turnoId, null);
});

const SELLO = {
  clientUuid: "11111111-1111-1111-1111-111111111111",
  tsDispositivo: "2026-08-11T10:00:00Z",
  tzOffsetMin: -240,
};

test("cerrarCarga produce la captura con Wh enteros, sin costo_clp y sin soc_inicial (§4.8)", () => {
  const sesion = iniciarCarga("veh-1", "turno-1");
  const captura = cerrarCarga(sesion, { kwh: 20, socFinal: 90 }, SELLO);
  assert.deepEqual(captura, {
    clientUuid: SELLO.clientUuid,
    vehiculoId: "veh-1",
    turnoId: "turno-1",
    wh: 20_000,
    socInicial: null,
    socFinal: 90,
    tsDispositivo: SELLO.tsDispositivo,
    tzOffsetMin: SELLO.tzOffsetMin,
    estado: "por_replicar",
  });
  assert.ok(!Object.keys(captura!).includes("costoClp"), "el flujo del chofer no manda costo (§4.8)");
});

test("cerrarCarga sin sesión iniciada no produce captura", () => {
  const sesion = { vehiculoId: "veh-1", turnoId: null, iniciada: false };
  assert.equal(cerrarCarga(sesion, { kwh: 20, socFinal: 90 }, SELLO), null);
});

test("cerrarCarga con kWh cero o negativo no produce captura (validación bloqueante en el cliente, §4.2)", () => {
  const sesion = iniciarCarga("veh-1", null);
  assert.equal(cerrarCarga(sesion, { kwh: 0, socFinal: 90 }, SELLO), null);
  assert.equal(cerrarCarga(sesion, { kwh: -5, socFinal: 90 }, SELLO), null);
});

test("cerrarCarga con SOC final fuera de 0..100 no produce captura", () => {
  const sesion = iniciarCarga("veh-1", null);
  assert.equal(cerrarCarga(sesion, { kwh: 10, socFinal: 101 }, SELLO), null);
  assert.equal(cerrarCarga(sesion, { kwh: 10, socFinal: -1 }, SELLO), null);
});

test("cerrarCarga con SOC final null es válido: el chofer puede no saberlo", () => {
  const sesion = iniciarCarga("veh-1", null);
  assert.equal(cerrarCarga(sesion, { kwh: 10, socFinal: null }, SELLO)?.socFinal, null);
});
