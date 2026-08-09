#!/usr/bin/env node
// Mutantes del gate de documentos [AC-FTEN-25].
//
// Un gate que revisa documentos es fácil de escribir de modo que nunca se ponga rojo: basta
// con un patrón demasiado laxo. Cada mutante saca EXACTAMENTE una cosa del runbook real y
// exige que el gate lo note — así se sabe que cada sección y cada exigencia están vivas por
// separado, y no que una sola las tapa a todas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { revisar, DOCUMENTOS } from "./gate-documentos.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const RUNBOOK = DOCUMENTOS.find((d) => d.ac === "AC-FTEN-25");
const ORIGINAL = readFileSync(join(RAIZ, RUNBOOK.archivo), "utf8");

/** Un repo de mentira con UN documento mutado, revisado contra su propia fila del contrato. */
function conDocumento(doc, texto) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-docs-"));
  mkdirSync(join(raiz, "docs"), { recursive: true });
  writeFileSync(join(raiz, doc.archivo), texto);
  return revisar(raiz, [doc]);
}
const conRunbook = (texto) => conDocumento(RUNBOOK, texto);

test("[AC-FTEN-25] el runbook real pasa (el gate no es un no-op al revés)", () => {
  assert.deepEqual(revisar(RAIZ), []);
});

test("[AC-FTEN-25] sin el archivo, el gate lo dice y nombra el AC que lo exige", () => {
  const raiz = mkdtempSync(join(tmpdir(), "flota-docs-"));
  const problemas = revisar(raiz);
  // Uno por CADA documento del contrato: un repo sin documentos no puede quedar verde por
  // haber contado solo el primero que faltaba.
  assert.equal(problemas.length, DOCUMENTOS.length);
  for (const doc of DOCUMENTOS) {
    assert.ok(
      problemas.some((p) => p.includes(doc.archivo) && p.includes("no existe") && p.includes(doc.ac)),
      `no se reportó la ausencia de ${doc.archivo}`,
    );
  }
});

test("[AC-FTEN-25] un archivo vacío con el nombre correcto NO pasa", () => {
  const problemas = conRunbook("# Runbook\n");
  assert.ok(problemas.length >= RUNBOOK.secciones.length, "un archivo vacío pasó el gate");
});

for (const seccion of RUNBOOK.secciones) {
  test(`[AC-FTEN-25] sin la sección «${seccion}» ⇒ rojo`, () => {
    const mutado = ORIGINAL.replace(
      new RegExp(`^#{1,6}\\s+${seccion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im"),
      "## Otra cosa",
    );
    assert.notEqual(mutado, ORIGINAL, `el mutante de «${seccion}» no cambió nada`);
    const problemas = conRunbook(mutado);
    assert.ok(
      problemas.some((p) => p.includes(seccion)),
      `el gate no notó que falta «${seccion}»: ${JSON.stringify(problemas)}`,
    );
  });
}

test("[AC-FTEN-25] sin el plazo de 72 h ⇒ rojo: es el número que dictó el dueño", () => {
  const problemas = conRunbook(ORIGINAL.replaceAll("72 horas", "un rato").replaceAll("72 h", "un rato"));
  assert.ok(problemas.some((p) => p.includes("72 h")), JSON.stringify(problemas));
});

test("[AC-FTEN-25] sin el responsable nombrado ⇒ rojo: un runbook sin dueño no se ejecuta", () => {
  const problemas = conRunbook(ORIGINAL.replaceAll("Alexis", "alguien"));
  assert.ok(problemas.some((p) => p.includes("responsable")), JSON.stringify(problemas));
});

test("[AC-FTEN-25] sin la remisión a AC-FTEN-16 ⇒ rojo: el AC exige que remita", () => {
  const problemas = conRunbook(ORIGINAL.replaceAll("AC-FTEN-16", "otro AC"));
  assert.ok(problemas.some((p) => p.includes("AC-FTEN-16")), JSON.stringify(problemas));
});

// --- Instancia dedicada ---------------------------------------------------------- [AC-FTEN-23]
const DEDICADA = DOCUMENTOS.find((d) => d.ac === "AC-FTEN-23");
const DEDICADA_ORIGINAL = readFileSync(join(RAIZ, DEDICADA.archivo), "utf8");

test("[AC-FTEN-23] el documento de instancia dedicada real pasa", () => {
  assert.deepEqual(revisar(RAIZ, [DEDICADA]), []);
});

for (const [nombre, buscar] of [
  ["la misma tenant_template", /misma\s+`?tenant_template`?/gi],
  ["que corre en otro host", /otro\s+host/gi],
  ["que NO se construye en el MVP", /no se construye en E1|no construida en el MVP/gi],
]) {
  test(`[AC-FTEN-23] sin ${nombre} ⇒ rojo`, () => {
    const mutado = DEDICADA_ORIGINAL.replace(buscar, "otra cosa");
    assert.notEqual(mutado, DEDICADA_ORIGINAL, "el mutante no cambió nada");
    const problemas = conDocumento(DEDICADA, mutado);
    assert.ok(problemas.length > 0, `el gate no notó que falta ${nombre}`);
  });
}

test("[AC-FTEN-23] un documento que solo promete la instancia, sin decir que no está construida, NO pasa", () => {
  // Sin esa línea el archivo se lee como una promesa de producto, y el §0 lo pone en la
  // columna «documentado, no construido» justamente para que nadie lo venda.
  const promesa = DEDICADA_ORIGINAL.replace(
    /## Condición: DOCUMENTADA, no construida en el MVP[\s\S]*?(?=\n## )/,
    "## Disponible ahora\n\nSe entrega con el plan Empresa.\n\n",
  );
  const problemas = conDocumento(DEDICADA, promesa);
  assert.ok(problemas.length > 0, "una promesa de producto pasó el gate");
});
