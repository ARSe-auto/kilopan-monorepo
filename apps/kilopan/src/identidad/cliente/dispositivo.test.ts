import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { leerDispositivo } from "./dispositivo.ts";

// AC-SEC-05: el secreto del dispositivo NO puede vivir en localStorage — es legible de
// un paso con `localStorage.getItem(...)` por cualquier script del origen (consola,
// extensión, librería de terceros comprometida). Node no tiene IndexedDB para probar el
// round-trip real contra un navegador (igual que src/pod/outbox.ts, que por el mismo
// motivo prueba su contrato en vez del almacenamiento); lo que SÍ se puede probar acá,
// sin navegador, es la ausencia: que el módulo no vuelva a usar localStorage.
//
// Se descartan las líneas `//` antes de buscar: el propio comentario de este archivo
// (arriba) menciona la palabra "localStorage" al explicar la migración, y un chequeo
// sobre el texto crudo se dispara contra su propia documentación en vez de contra código.
const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "dispositivo.ts"), "utf8");
const codigo = fuente.replace(/^\s*\/\/.*$/gm, "");

test("dispositivo.ts: el secreto del equipo no se guarda en localStorage [AC-SEC-05]", () => {
  assert.ok(
    !/localStorage/.test(codigo),
    "el secreto del dispositivo debe vivir en IndexedDB, nunca en localStorage (AC-SEC-05)"
  );
  assert.ok(/indexedDB/.test(codigo), "debe persistir el secreto vía IndexedDB");
});

test("leerDispositivo(): sin window (SSR/Node) devuelve null sin lanzar [AC-SEC-05]", async () => {
  assert.equal(await leerDispositivo(), null);
});
