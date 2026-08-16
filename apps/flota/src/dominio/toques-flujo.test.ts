import test from "node:test";
import assert from "node:assert/strict";
import { metricaDeToques } from "./toques-flujo.ts";

// Mutantes de la métrica de toques-hasta-completar [AC-FRUT-19] — §5.3, §4.6.

test("arma la fila con el tipo fijo, el flujo y el conteo tal como viajan por el cable", () => {
  const ts = new Date("2026-08-15T09:00:00Z");
  const fila = metricaDeToques("alta_encargo", 4, "11111111-1111-1111-1111-111111111111", ts, -180);
  assert.deepEqual(fila, {
    tipo: "toques_flujo",
    flujo: "alta_encargo",
    valor_int: 4,
    client_uuid: "11111111-1111-1111-1111-111111111111",
    ts: "2026-08-15T09:00:00.000Z",
    tz_offset_min: -180,
  });
});

test("cada flujo del módulo produce su propia etiqueta, sin mezclarse", () => {
  const ts = new Date("2026-08-15T09:00:00Z");
  const flujos = ["alta_encargo", "publicar_dia", "recepcion_custodia", "cierre_ruta"] as const;
  for (const flujo of flujos) {
    const fila = metricaDeToques(flujo, 1, "22222222-2222-2222-2222-222222222222", ts, 0);
    assert.equal(fila.flujo, flujo);
  }
});

test("el conteo viaja tal cual, sin redondear ni acotar — el presupuesto lo mira el panel, no esta función", () => {
  const ts = new Date("2026-08-15T09:00:00Z");
  const fila = metricaDeToques("publicar_dia", 17, "33333333-3333-3333-3333-333333333333", ts, 0);
  assert.equal(fila.valor_int, 17);
});

test("el doble reloj viaja completo: ISO del dispositivo y su huso, no el del servidor", () => {
  const ts = new Date("2026-08-15T23:30:00Z");
  const fila = metricaDeToques("cierre_ruta", 3, "44444444-4444-4444-4444-444444444444", ts, -240);
  assert.equal(fila.ts, "2026-08-15T23:30:00.000Z");
  assert.equal(fila.tz_offset_min, -240);
});
