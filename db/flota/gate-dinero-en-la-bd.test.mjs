#!/usr/bin/env node
// Mutantes del gate de dinero: cada uno planta el defecto que el gate existe para atrapar.
// [AC-FTAR-03]
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculaConDinero, sinComentarios, revisar } from "./gate-dinero-en-la-bd.mjs";

test("[AC-FTAR-03] sumar o multiplicar pesos fuera de la BD dispara", () => {
  assert.equal(calculaConDinero("const total = subtotal + monto_clp;"), "aritmética");
  assert.equal(calculaConDinero("const t = precioClp * cantidad;"), "aritmética");
  assert.equal(calculaConDinero("const neto = totalClp - descuento;"), "aritmética");
  assert.equal(calculaConDinero("const u = monto_clp / bultos;"), "aritmética");
});

test("[AC-FTAR-03] pasar un monto por un flotante dispara", () => {
  assert.equal(calculaConDinero("const m = parseFloat(fila.monto_clp);"), "flotante");
  assert.equal(calculaConDinero("etiqueta = fila.montoClp.toFixed(2);"), "flotante");
});

test("[AC-FTAR-03] NOMBRAR un monto está permitido en todas partes", () => {
  assert.equal(calculaConDinero("select monto_clp from liquidacion_lineas"), null);
  assert.equal(calculaConDinero("const { montoClp } = fila;"), null);
  assert.equal(calculaConDinero("assert.equal(fila.monto_clp, 3500);"), null);
  assert.equal(calculaConDinero("costo_clp: null,"), null);
});

test("[AC-FTAR-03] un comentario que explica la fórmula no es la fórmula", () => {
  const texto = sinComentarios("// el monto es precio_clp + zona\nconst x = 1;");
  assert.equal(calculaConDinero(texto.split("\n")[0]), null);
});

test("[AC-FTAR-03] el gate encuentra el defecto plantado en un árbol de verdad", () => {
  const raiz = mkdtempSync(join(tmpdir(), "gate-dinero-"));
  mkdirSync(join(raiz, "apps/flota/src"), { recursive: true });
  writeFileSync(
    join(raiz, "apps/flota/src/total.ts"),
    "export const total = (a: number, b: number) => a + b;\nexport const x = base_clp * 2;\n",
  );
  const { hallazgos, revisados } = revisar(raiz, ["apps/flota"]);
  assert.equal(revisados, 1);
  assert.equal(hallazgos.length, 1);
  assert.equal(hallazgos[0].clase, "aritmética");
  assert.equal(hallazgos[0].linea, 2);
});

test("[AC-FTAR-03] y deja pasar el árbol que solo nombra montos", () => {
  const raiz = mkdtempSync(join(tmpdir(), "gate-dinero-"));
  mkdirSync(join(raiz, "apps/flota/src"), { recursive: true });
  writeFileSync(
    join(raiz, "apps/flota/src/lectura.ts"),
    'export const consulta = "select monto_clp, precio_base_clp from liquidacion_lineas";\n',
  );
  assert.deepEqual(revisar(raiz, ["apps/flota"]).hallazgos, []);
});
