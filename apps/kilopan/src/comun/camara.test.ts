import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-PERF-02: compresión de fotos en el cliente — 1280 px de ancho máximo, calidad 0.72.
// `capturar()` usa Canvas/getUserMedia, que Node no tiene (mismo motivo por el que
// dispositivo.test.ts prueba IndexedDB por ausencia de código, no por ejecución): lo que
// SÍ se puede probar sin navegador es que los valores que exige el AC siguen siendo
// exactamente esos en el código fuente — un cambio silencioso a, por ejemplo, calidad 0.9
// o 1920 px de ancho no lo agarraba nada antes de este test (Anexo D, auditoría 2-ago-2026).
const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "camara.ts"), "utf8");

test("camara.ts: ancho máximo de compresión es 1280 px [AC-PERF-02]", () => {
  assert.match(fuente, /const ANCHO_MAX = 1280;/);
});

test("camara.ts: calidad JPEG de compresión es 0.72 [AC-PERF-02]", () => {
  assert.match(fuente, /const CALIDAD = 0\.72;/);
});
