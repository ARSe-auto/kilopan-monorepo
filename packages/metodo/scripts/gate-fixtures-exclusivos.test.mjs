// La suite de gate-fixtures-exclusivos.mjs.
//
// El caso central es el REAL: tres suites reclamando el mismo índice para su persona, que el
// 12-ago-2026 hizo morir un `beforeAll` con `duplicate key ... personas_tenant_id_rut_key` y
// apareció como «cola-offline no encontrado», a tres pasos de la causa.
//
// Y el caso que más importa después de ése es el CONTRARIO: que compartir un RUT que NO se
// declara exclusivo siga siendo legal. El índice 1 lo usan catorce suites y el 6 —la empresa
// contratante— se comparte a propósito. Un gate que las mordiera saldría rojo sobre archivos
// sanos y lo apagarían el primer día.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indicesExclusivos, reclamosDe, choques } from "./gate-fixtures-exclusivos.mjs";

const LISTA = `
export const VALIDOS = {
  "11.111.111-1": "la dueña del tenant, compartida entre suites a propósito",
  "76.111.111-6": "la EMPRESA contratante: se comparte, y sus insert usan on conflict",
  "6.666.666-2": "el chofer de F4, propio y no prestado: un dispositivo personal por operario",
  "8.765.432-K": "el segundo chofer de F4, propio y no prestado: mismo motivo",
};
`;

/** Un árbol de mentira: la lista congelada + las suites que se le pasen. */
function arbol(suites) {
  const raiz = mkdtempSync(join(tmpdir(), "fx-gate-"));
  mkdirSync(join(raiz, "db", "flota"), { recursive: true });
  mkdirSync(join(raiz, "apps", "flota", "e2e"), { recursive: true });
  writeFileSync(join(raiz, "db", "flota", "ruts-sinteticos.mjs"), LISTA);
  for (const [nombre, texto] of Object.entries(suites)) {
    writeFileSync(join(raiz, "apps", "flota", "e2e", nombre), texto);
  }
  return raiz;
}

test("EL CASO REAL: dos suites reclaman el mismo RUT exclusivo ⇒ ROJO", () => {
  const raiz = arbol({
    "a.spec.ts": "const RUT = rutDeFixture(2);",
    "b.spec.ts": "const RUT = rutDeFixture(2);",
  });
  const { fallos } = choques(raiz);
  assert.equal(fallos.length, 1);
  assert.equal(fallos[0].indice, 2);
  assert.deepEqual(fallos[0].suites, ["a.spec.ts", "b.spec.ts"]);
});

test("compartir un RUT que NO se declara exclusivo sigue siendo legal ⇒ VERDE", () => {
  // El índice 1 es la empresa contratante: catorce suites la comparten y sus insert usan
  // `on conflict`. Morder esto sería el fin del gate: lo apagarían el primer día.
  const raiz = arbol({
    "a.spec.ts": "const EMPRESA = rutDeFixture(1);",
    "b.spec.ts": "const EMPRESA = rutDeFixture(1);",
    "c.spec.ts": "const EMPRESA = rutDeFixture(1);",
  });
  assert.deepEqual(choques(raiz).fallos, []);
});

test("un RUT exclusivo usado por UNA sola suite ⇒ VERDE", () => {
  const raiz = arbol({ "a.spec.ts": "const RUT = rutDeFixture(2);" });
  assert.deepEqual(choques(raiz).fallos, []);
});

test("la MISMA suite pidiéndolo dos veces no es un choque", () => {
  // Pedirlo en dos lugares del mismo archivo es una sola dueña: contar apariciones en vez de
  // archivos convertiría el gate en un alarmista.
  const raiz = arbol({ "a.spec.ts": "rutDeFixture(2);\nconst OTRO = rutDeFixture(2);" });
  assert.deepEqual(choques(raiz).fallos, []);
});

test("también ve la forma vieja, por índice sobre VALIDOS", () => {
  // Media docena de suites todavía usan `Object.keys(VALIDOS)[n]`. Mirar solo la forma nueva
  // dejaría medio árbol sin vigilar y el gate diría verde sobre lo que no miró.
  const raiz = arbol({
    "a.spec.ts": "const RUT = Object.keys(VALIDOS)[2]!;",
    "b.spec.ts": "const RUT = rutDeFixture(2);",
  });
  assert.equal(choques(raiz).fallos.length, 1);
});

test("los índices exclusivos se leen por POSICIÓN, que es como los piden las suites", () => {
  assert.deepEqual(indicesExclusivos(LISTA), [2, 3]);
});

test("los reclamos se agrupan por índice y por archivo", () => {
  const raiz = arbol({ "a.spec.ts": "rutDeFixture(2); rutDeFixture(3);" });
  const r = reclamosDe(join(raiz, "apps", "flota", "e2e"));
  assert.deepEqual(r[2], ["a.spec.ts"]);
  assert.deepEqual(r[3], ["a.spec.ts"]);
});
