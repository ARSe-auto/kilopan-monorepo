#!/usr/bin/env node
// Mutantes del guardián de la lista congelada de criterios KiloRuta [AC-FTEN-18].
//
// El guardián sale VERDE contra la lista real; estos mutantes prueban que sale ROJO contra
// cada deformación que existe para atrapar. Un gate que nunca se pone rojo no es un gate
// (docs/LECCION_RALPH.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("../..", import.meta.url).pathname;
const GUARDIAN = join(RAIZ, "db/flota/gate-criterios-kiloruta.mjs");
const LISTA = join(RAIZ, "docs/criterios-kiloruta.txt");
const original = readFileSync(LISTA, "utf8");

/** Corre el guardián sobre un texto de lista y devuelve {codigo, salida}. */
function correr(texto) {
  const dir = mkdtempSync(join(tmpdir(), "kr-"));
  const ruta = join(dir, "criterios-kiloruta.txt");
  writeFileSync(ruta, texto);
  try {
    const salida = execFileSync("node", [GUARDIAN, `--lista=${ruta}`], { encoding: "utf8" });
    return { codigo: 0, salida };
  } catch (e) {
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("la lista real del repo pasa el guardián", () => {
  const { codigo, salida } = correr(original);
  assert.equal(codigo, 0, salida);
  assert.match(salida, /63 criterios congelados/);
});

test("N declarada que no coincide con los criterios presentes ⇒ rojo", () => {
  const { codigo, salida } = correr(original.replace(/^N = 63$/m, "N = 62"));
  assert.equal(codigo, 1);
  assert.match(salida, /declara N = 62 pero trae 63/);
});

test("un ID repetido ⇒ rojo (un KR reciclado cambia de significado en silencio)", () => {
  const { codigo, salida } = correr(original.replace(/^KR-63 \[/m, "KR-62 ["));
  assert.equal(codigo, 1);
  assert.match(salida, /KR-62 aparece más de una vez/);
});

test("un hueco en la numeración ⇒ rojo", () => {
  // Borra KR-30 entero (su línea y sus continuaciones, hasta el próximo KR-).
  const sinUno = original.replace(/^KR-30 \[[\s\S]*?(?=^KR-31 )/m, "");
  const { codigo, salida } = correr(sinUno);
  assert.equal(codigo, 1);
  assert.match(salida, /falta KR-30/);
});

test("una clase fuera del conjunto cerrado ⇒ rojo", () => {
  const { codigo, salida } = correr(original.replace("KR-02 [cubierto]", "KR-02 [masomenos]"));
  assert.equal(codigo, 1);
  assert.match(salida, /clase 'masomenos' fuera del conjunto cerrado/);
});

test("sin la firma del dueño ⇒ rojo (el oráculo de AC-FTEN-18 es humano)", () => {
  const { codigo, salida } = correr(original.replace(/^Aprobada por Alexis el .*$/m, ""));
  assert.equal(codigo, 1);
  assert.match(salida, /no lleva la firma del dueño/);
});

test("la lista declarando dos veces su N ⇒ rojo", () => {
  const { codigo, salida } = correr(original.replace(/^N = 63$/m, "N = 63\nN = 63"));
  assert.equal(codigo, 1);
  assert.match(salida, /declara 2 veces su N/);
});

test("sin archivo de lista ⇒ rojo", () => {
  const dir = mkdtempSync(join(tmpdir(), "kr-"));
  let codigo = 0;
  let salida = "";
  try {
    execFileSync("node", [GUARDIAN, `--lista=${join(dir, "no-existe.txt")}`], { encoding: "utf8" });
  } catch (e) {
    codigo = e.status ?? 1;
    salida = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  assert.equal(codigo, 1);
  assert.match(salida, /falta docs\/criterios-kiloruta\.txt/);
});
