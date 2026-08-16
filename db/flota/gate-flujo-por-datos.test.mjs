import test from "node:test";
import assert from "node:assert/strict";
import {
  condicionalesEn,
  sinComentarios,
  catalogoDeVerticales,
  DONDE_VIVE_EL_CATALOGO,
} from "./gate-flujo-por-datos.mjs";

// Mutantes del chequeo de flujo por datos [AC-FMIG-15] — §4.6, §4.9: cero condicionales por
// vertical en la UI. Cada caso es una forma REAL en que alguien ramificaría por el nombre de un
// vertical, y su gemelo es un uso legítimo de la palabra que NO puede rebotar.

const CATALOGO = ["panaderia"];

test("=== contra el nombre del vertical se detecta", () => {
  const ts = `if (tenant.vertical === "panaderia") { return <ChecklistDePan />; }`;
  const ofensas = condicionalesEn(ts, CATALOGO);
  assert.equal(ofensas.length, 1);
  assert.equal(ofensas[0].vertical, "panaderia");
});

test("con el literal a la izquierda también se detecta", () => {
  assert.equal(condicionalesEn(`"panaderia" === vertical`, CATALOGO).length, 1);
});

test("un switch/case contra el vertical se detecta", () => {
  const ts = `switch (vertical) {\n  case "panaderia":\n    return algo();\n}`;
  const ofensas = condicionalesEn(ts, CATALOGO);
  assert.equal(ofensas.length, 1);
  assert.equal(ofensas[0].linea, 2);
});

test("con comillas simples o backtick también", () => {
  assert.equal(condicionalesEn(`vertical === 'panaderia'`, CATALOGO).length, 1);
  assert.equal(condicionalesEn("vertical === `panaderia`", CATALOGO).length, 1);
});

// ─── Los gemelos: lo que NO puede rebotar ────────────────────────────────────────────

test("reenviar el parámetro sin ramificar no es un condicional", () => {
  assert.deepEqual(condicionalesEn(`sembrarMotivos(pool, vertical)`, CATALOGO), []);
});

test("validar que el parámetro no vino vacío no es ramificar por su nombre", () => {
  assert.deepEqual(condicionalesEn(`if (vertical === "") { return errorFaltaVertical(); }`, CATALOGO), []);
});

test("nombrar el vertical en un comentario para explicar el invariante es legítimo", () => {
  const ts = `// acá no se nombra ni un solo vertical, ni "panaderia" (§4.6)
              const req = filas.filter((r) => r.obligatorio);`;
  assert.deepEqual(condicionalesEn(ts, CATALOGO), []);
});

test("ni dentro de un bloque /* */", () => {
  const ts = `/* si esto dijera vertical === "panaderia" sería un bug */
              const x = 1;`;
  assert.deepEqual(condicionalesEn(ts, CATALOGO), []);
});

test("leer stop_requirement/cargo_type no es mirar el vertical", () => {
  const ts = `const requisitos = filas.filter((r) => r.parada_id === paradaId);`;
  assert.deepEqual(condicionalesEn(ts, CATALOGO), []);
});

// ─── El positivo, que impide el verde vacuo ─────────────────────────────────────────

test("el catálogo se lee del wizard y hoy trae panaderia", () => {
  assert.deepEqual(catalogoDeVerticales(new URL("../..", import.meta.url).pathname), ["panaderia"]);
});

test("DONDE_VIVE_EL_CATALOGO apunta al wizard de verdad", () => {
  assert.equal(DONDE_VIVE_EL_CATALOGO, "db/flota/wizard-onboarding.mjs");
});

test("`sinComentarios` conserva el número de líneas", () => {
  const texto = "uno\n/* dos\ntres */\ncuatro";
  assert.equal(sinComentarios(texto).split("\n").length, texto.split("\n").length);
});
