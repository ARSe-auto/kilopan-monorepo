import test from "node:test";
import assert from "node:assert/strict";
import { leerCsv, partirLinea, normalizarColumna } from "./csv.ts";

// Mutantes del lector de CSV [AC-FRUT-02].
//
// Lo que estos casos protegen: que un archivo mal leído NO entre. Un CSV mal parseado no falla
// —entra todo, corrido de lugar— y eso se descubre con el camión cargado.

test("una coma DENTRO de comillas no parte el campo", () => {
  // El caso que un `split(',')` arruina: una dirección con coma manda el camión a otra parte.
  assert.deepEqual(
    partirLinea('Panadería,"Av. Matta 1234, local 5",30', ","),
    ["Panadería", "Av. Matta 1234, local 5", "30"],
  );
});

test("dos comillas seguidas son una comilla literal (RFC 4180)", () => {
  assert.deepEqual(
    partirLinea('"Panadería ""La Espiga""",Centro,10', ","),
    ['Panadería "La Espiga"', "Centro", "10"],
  );
});

test("el punto y coma de Excel en es-CL se detecta solo", () => {
  // Excel con configuración regional chilena exporta con punto y coma. Rechazarle el archivo
  // al operador por eso sería hacerle perder el tiempo por algo que no eligió.
  const r = leerCsv("empresa;destino;bultos\nPanadería;Centro;30\n", ["empresa", "destino", "bultos"]);
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") assert.deepEqual(r.filas[0], { empresa: "Panadería", destino: "Centro", bultos: "30" });
});

test("CRLF y LF se leen igual", () => {
  for (const salto of ["\r\n", "\n"]) {
    const r = leerCsv(`empresa,destino,bultos${salto}Panadería,Centro,30${salto}`, ["bultos"]);
    assert.equal(r.tipo, "ok", salto === "\r\n" ? "CRLF" : "LF");
  }
});

test("el encabezado se normaliza: acentos y mayúsculas no rechazan el archivo", () => {
  assert.equal(normalizarColumna("  Razón Social "), "razon_social");
  const r = leerCsv("EMPRESA,Destino,BULTOS\nPanadería,Centro,30", ["empresa", "destino", "bultos"]);
  assert.equal(r.tipo, "ok");
});

test("si falta una columna se dicen TODAS las que faltan, no la primera", () => {
  // Quien arma el archivo lo corrige de una vez en vez de subirlo tres veces.
  const r = leerCsv("empresa\nPanadería", ["empresa", "destino", "bultos"]);
  assert.equal(r.tipo, "faltan_columnas");
  if (r.tipo === "faltan_columnas") assert.deepEqual(r.columnas.sort(), ["bultos", "destino"]);
});

test("un archivo con solo encabezado es vacío, no un archivo de cero filas válidas", () => {
  // La diferencia importa: «no había nada que importar» y «se importaron cero» son dos cosas, y
  // la segunda dejaría al operador esperando encargos que nunca pidió.
  assert.equal(leerCsv("empresa,destino,bultos\n", ["empresa"]).tipo, "vacio");
  assert.equal(leerCsv("", ["empresa"]).tipo, "vacio");
});

test("una fila con menos campos que el encabezado no rompe: completa con vacío", () => {
  // Y ese vacío va a rebotar después como dato inválido, que es donde tiene que rebotar — acá
  // lanzar una excepción perdería las demás filas del archivo.
  const r = leerCsv("empresa,destino,bultos\nPanadería,Centro", ["bultos"]);
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") assert.equal(r.filas[0]!.bultos, "");
});
