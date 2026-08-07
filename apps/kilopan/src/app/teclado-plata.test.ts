import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

function fuenteSinComentarios(ruta: string): string {
  const bruto = readFileSync(join(DIR, ruta), "utf8");
  return bruto.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// AC-H0-13: el teclado grande (TecladoNumerico) tiene que estar en cualquier campo de
// plata, incluido el arqueo — ningún control del sistema (F23, docs/PROMPT_CORRECTIVO.md
// §5) en un campo que un panadero real toca a diario. Estos casos cubren lo que quedaba
// con el teclado chico del sistema (parámetros $/km, precios del catálogo, monto del
// DTE) y dejan una guarda de regresión sobre el arqueo (cierre de caja y apertura de
// turno).

test("cierre de caja (arqueo del día) sigue con teclado propio, no el del sistema [AC-H0-13]", () => {
  const codigo = fuenteSinComentarios("caja/page.tsx");
  assert.match(codigo, /<TecladoNumerico/, "el arqueo de /caja perdió su teclado propio");
  assert.doesNotMatch(codigo, /<input[^>]*inputMode=/, "un campo de plata de /caja quedó con el teclado del sistema");
});

test("apertura de turno (fondo del arqueo) sigue con teclado propio [AC-H0-13]", () => {
  const codigo = fuenteSinComentarios("apertura-turno/page.tsx");
  assert.match(codigo, /<TecladoNumerico valor=\{fondo\}/, "el fondo inicial del arqueo perdió su teclado propio");
});

test("los parámetros de plata ($/km) de Ajustes usan teclado propio, no <input type=number> [AC-H0-13]", () => {
  const codigo = fuenteSinComentarios("admin/page.tsx");
  assert.match(codigo, /p\.clave\.startsWith\("clp_"\)/, "Ajustes no distingue los parámetros de plata del resto");
  assert.match(codigo, /<TecladoNumerico\s+valor=\{borradoresClp\[campoClpActivo\]/, "el parámetro clp_* no abre el teclado propio");
});

test("precio de mostrador y mayorista del catálogo usan teclado propio [AC-H0-13]", () => {
  const codigo = fuenteSinComentarios("admin/page.tsx");
  assert.doesNotMatch(codigo, /<input value=\{precioMostrador\}/, "precio de mostrador (crear) sigue con el teclado del sistema");
  assert.doesNotMatch(codigo, /<input value=\{precioMayorista\}/, "precio mayorista (crear) sigue con el teclado del sistema");
  assert.doesNotMatch(codigo, /<input\s+value=\{editMostrador\}/, "precio de mostrador (editar) sigue con el teclado del sistema");
  assert.doesNotMatch(codigo, /<input\s+value=\{editMayorista\}/, "precio mayorista (editar) sigue con el teclado del sistema");
  assert.match(codigo, /function TecladoDeCampo/, "falta el teclado compartido de precios del catálogo");
  assert.match(codigo, /<TecladoNumerico valor=\{valor\} onCambiar=\{/, "TecladoDeCampo no monta el teclado propio");
});

test("el monto del documento (DTE) en Despacho usa teclado propio, no <input inputMode=numeric> [AC-H0-13]", () => {
  const codigo = fuenteSinComentarios("pedidos/page.tsx");
  assert.doesNotMatch(codigo, /<input value=\{dteMonto\}/, "el monto del DTE sigue con el teclado del sistema");
  assert.match(codigo, /<TecladoNumerico valor=\{dteMonto\}/, "el monto del DTE no abre el teclado propio");
  // El folio SÍ sigue con el <input> nativo a propósito: es un identificador de
  // documento, no plata — el AC pide teclado grande en campos de PLATA, no en todo número.
  assert.match(codigo, /<input value=\{dteFolio\}/, "el folio del DTE no debería haber cambiado — no es un campo de plata");
});
