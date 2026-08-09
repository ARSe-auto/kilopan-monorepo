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

/** Un repo de mentira con el runbook mutado. */
function conRunbook(texto) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-docs-"));
  mkdirSync(join(raiz, "docs"), { recursive: true });
  writeFileSync(join(raiz, RUNBOOK.archivo), texto);
  return revisar(raiz);
}

test("[AC-FTEN-25] el runbook real pasa (el gate no es un no-op al revés)", () => {
  assert.deepEqual(revisar(RAIZ), []);
});

test("[AC-FTEN-25] sin el archivo, el gate lo dice y nombra el AC que lo exige", () => {
  const raiz = mkdtempSync(join(tmpdir(), "flota-docs-"));
  const problemas = revisar(raiz);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /no existe/);
  assert.match(problemas[0], /AC-FTEN-25/);
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
