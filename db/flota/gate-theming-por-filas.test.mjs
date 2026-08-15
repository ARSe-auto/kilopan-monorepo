#!/usr/bin/env node
// Mutantes del grep-gate de theming por filas [AC-FMIG-02].
//
// Los dos casos de rebote que el AC exige: un `backdrop-filter` plantado en una pantalla, y
// un identificador que prometa CSS libre por tenant. Se plantan en un SANDBOX (--raiz),
// nunca en el árbol real — la misma disciplina que `gate-constantes.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const GATE = join(RAIZ, "db/flota/gate-theming-por-filas.mjs");

function sandbox(archivos = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-liquidglass-"));
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
    assert.match(salida, /gate-theming-por-filas: VERDE/);
  } catch (e) {
    assert.fail(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});

test("backdrop-filter en una pantalla de packages/miga ⇒ ROJO", () => {
  const raiz = sandbox({
    "packages/miga/src/componentes/.fixture.tsx": "const s = { backdropFilter: 'blur(8px)' };\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1);
  assert.match(salida, /backdrop-filter/);
});

test("-webkit-backdrop-filter en CSS de una pantalla de apps/flota ⇒ ROJO", () => {
  const raiz = sandbox({
    "apps/flota/src/app/turno/.fixture.css": ".panel { -webkit-backdrop-filter: blur(12px); }\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1);
  assert.match(salida, /backdrop-filter/);
});

test("backdrop-filter DENTRO de apps/flota/src/app/api/ NO dispara — las rutas HTTP no son pantallas", () => {
  const raiz = sandbox({
    "apps/flota/src/app/api/tema/.fixture.ts": "// backdrop-filter mencionado en un comentario de una ruta\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("un identificador de CSS arbitrario por tenant ⇒ ROJO (regla estática b)", () => {
  for (const identificador of ["custom_css", "cssLibre", "estilos_tenant", "raw_html"]) {
    const raiz = sandbox({
      "apps/flota/src/app/turno/.fixture.tsx": `const ${identificador} = tema.extras;\n`,
    });
    const { codigo, salida } = correr(raiz);
    assert.equal(codigo, 1, `«${identificador}» debía disparar el gate`);
    assert.match(salida, /CSS arbitrario por tenant/);
  }
});

test("un archivo sano que solo usa las 4 custom properties del contrato NO dispara nada", () => {
  const raiz = sandbox({
    "packages/miga/src/componentes/.fixture.tsx":
      "const s = { color: 'var(--miga-acento)', background: 'var(--miga-fondo)' };\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});
