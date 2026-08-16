#!/usr/bin/env node
// Mutantes del grep-gate de selectores de e2e [AC-FMIG-04].
//
// El caso de rebote que el AC exige textualmente: «PR con getByText sobre un renombrable ⇒
// lint rojo». Se planta en un SANDBOX (--raiz), nunca en el árbol real — la misma disciplina
// que `gate-theming-por-filas.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const GATE = join(RAIZ, "db/flota/gate-getbytext-renombrable.mjs");

function sandbox(archivos = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-getbytext-"));
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(join(raiz, rel, ".."), { recursive: true });
    writeFileSync(join(raiz, rel), contenido);
  }
  return raiz;
}

function correr(raiz) {
  try {
    return { codigo: 0, salida: execFileSync("node", [GATE, `--raiz=${raiz}`], { encoding: "utf8" }) };
  } catch (e) {
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("el repo real pasa el gate", () => {
  try {
    const salida = execFileSync("node", [GATE], { encoding: "utf8" });
    assert.match(salida, /gate-getbytext-renombrable: VERDE/);
  } catch (e) {
    assert.fail(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});

test("getByText sobre el SINGULAR de un renombrable ⇒ ROJO (caso de rebote textual del AC)", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": 'await expect(page.getByText("parada")).toBeVisible();\n',
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1, salida);
  assert.match(salida, /RENOMBRABLE/);
  assert.match(salida, /\.fixture\.spec\.ts:1/);
});

test("getByText sobre el PLURAL de un renombrable, con comillas simples ⇒ ROJO", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": "await expect(page.getByText('paradas')).toBeVisible();\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1, salida);
  assert.match(salida, /RENOMBRABLE/);
});

test("getByText es case-insensitive y tolera espacios sueltos ⇒ ROJO igual", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": 'await expect(page.getByText(" Parada ")).toBeVisible();\n',
  });
  const { codigo } = correr(raiz);
  assert.equal(codigo, 1);
});

test("getByText sobre texto FIJO que no es un renombrable NO dispara nada", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": 'await expect(page.getByText("Resolver", { exact: true })).toBeVisible();\n',
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("getByText con una variable (sin literal estático) NO se evalúa — no hay texto que comparar", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": "await expect(page.getByText(destino)).toBeVisible();\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("getByText con un template interpolado NO se evalúa como literal estático", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": "await expect(page.getByText(`parada ${n}`)).toBeVisible();\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("getByTestId sobre un renombrable NO dispara — es exactamente lo que el AC pide usar", () => {
  const raiz = sandbox({
    "apps/flota/e2e/.fixture.spec.ts": 'await expect(page.getByTestId("termino-parada")).toBeVisible();\n',
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("un renombrable fuera de apps/flota/e2e (por ejemplo en apps/flota/src) NO dispara — el alcance es SOLO los specs", () => {
  const raiz = sandbox({
    "apps/flota/src/app/hoy/.fixture.tsx": 'const x = page.getByText("parada");\n',
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});
