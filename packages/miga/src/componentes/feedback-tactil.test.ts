import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-FMIG-19 (§5.7, PWA iOS): «test de componente de packages/miga que FALLA si un
// control operativo carece del feedback táctil simulado (no hay Vibration API)». El
// feedback vive en UN solo lugar — `BotonTactil` (BotonTactil.tsx: hundimiento visual
// scale(0.96) al presionar, único sustituto posible del haptic real que Safari/PWA
// iOS no ofrece) — así que el oráculo no es «existe algún transform en algún lado»:
// es que cada `<button>` interactivo del paquete pase por esa superficie única. Un
// componente que renderiza `<button` a mano, sin `BotonTactil`, es exactamente el
// control sin feedback que este AC existe para atrapar.
//
// Mismo override que `estado-listado.test.ts`/`cifras.test.ts`: sin él, este archivo
// quedaría fuera del ejercicio de mutantes de verdad porque escanearía el árbol REAL en
// vez del árbol de juguete que los dos tests de abajo arman a propósito.
const DIR = process.env.MIGA_COMPONENTES_DIR ?? dirname(fileURLToPath(import.meta.url));

function botonesSinFeedback(dir: string): string[] {
  const rebotes: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (!nombre.endsWith(".tsx") || nombre === "BotonTactil.tsx") continue;
    const ruta = join(dir, nombre);
    const fuente = readFileSync(ruta, "utf8");
    // Mismo despoje de comentarios que el resto de la suite: un `<button` mencionado en
    // un comentario no debe ni salvar ni condenar un componente real.
    const codigo = fuente.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const tieneBotonCrudo = /<button\b/.test(codigo);
    const usaBotonTactil = /<BotonTactil\b/.test(codigo);
    if (tieneBotonCrudo && !usaBotonTactil) rebotes.push(nombre);
  }
  return rebotes;
}

test("todo <button> operativo de miga pasa por BotonTactil — feedback táctil simulado [AC-FMIG-19]", () => {
  const rebotes = botonesSinFeedback(DIR);
  assert.deepEqual(
    rebotes,
    [],
    `estos componentes tienen <button> sin pasar por BotonTactil (§5.7, sin Vibration API): ${rebotes.join(", ")}`,
  );
});

test("mutante: un <button> a mano sin BotonTactil pone el gate ROJO [AC-FMIG-19]", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "miga-tactil-"));
  try {
    writeFileSync(
      join(carpeta, "ControlSinFeedback.tsx"),
      'export function ControlSinFeedback() {\n  return <button type="button">Ir</button>;\n}\n',
    );
    assert.deepEqual(botonesSinFeedback(carpeta), ["ControlSinFeedback.tsx"]);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test("control positivo: un control que SÍ usa BotonTactil deja el gate VERDE [AC-FMIG-19]", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "miga-tactil-"));
  try {
    writeFileSync(
      join(carpeta, "ControlConFeedback.tsx"),
      'import { BotonTactil } from "./BotonTactil.tsx";\nexport function ControlConFeedback() {\n  return <BotonTactil type="button">Ir</BotonTactil>;\n}\n',
    );
    assert.deepEqual(botonesSinFeedback(carpeta), []);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
