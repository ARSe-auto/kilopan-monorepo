import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-DES-07: EscanerBulto usa getUserMedia/zxing-js/Web Audio — Node no tiene DOM ni
// cámara (mismo motivo por el que camara.test.ts y dispositivo.test.ts prueban por
// ausencia/contrato de código, no por ejecución). Lo que SÍ se puede probar sin navegador
// es que el contrato que exige el AC sigue presente en el código fuente: zxing-js,
// full-screen, linterna de 48 px, beep, vibración, y la degradación silenciosa (sin
// soporte de cámara el componente no renderiza nada — la captura manual de AC-DES-06
// queda como único camino, sin bloqueo).
const fuente = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "EscanerBulto.tsx"),
  "utf8"
);

test("EscanerBulto: usa zxing-js (BrowserMultiFormatReader) [AC-DES-07]", () => {
  assert.match(fuente, /BrowserMultiFormatReader/);
  assert.match(fuente, /@zxing\/library/);
});

test("EscanerBulto: degrada a manual sin bloquear si no hay cámara [AC-DES-07]", () => {
  assert.match(fuente, /if \(!soportado\) return null;/);
  assert.match(fuente, /getUserMedia/);
});

test("EscanerBulto: overlay full-screen por encima de la barra y las modales [AC-DES-07]", () => {
  assert.match(fuente, /position:\s*"fixed",\s*\n\s*inset:\s*0/);
});

test("EscanerBulto: linterna de 48 px, alcanzable con el pulgar [AC-DES-07]", () => {
  assert.match(fuente, /width:\s*48,\s*\n\s*height:\s*48/);
  assert.match(fuente, /applyConstraints/);
  assert.match(fuente, /torch/);
});

test("EscanerBulto: beep de escaneo exitoso (Web Audio, sin asset) [AC-DES-07]", () => {
  assert.match(fuente, /new AudioContext\(\)/);
  assert.match(fuente, /function pitarExito/);
});

test("EscanerBulto: vibración háptica al escanear con éxito [AC-DES-07]", () => {
  assert.match(fuente, /navigator\.vibrate\(200\)/);
});

test("EscanerBulto: la cámara se abre solo in-app por getUserMedia, jamás input de galería [AC-DES-07]", () => {
  assert.doesNotMatch(fuente, /<input[^>]*type=["']file["']/);
});
