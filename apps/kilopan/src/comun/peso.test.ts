import test from "node:test";
import assert from "node:assert/strict";
import { kgTextoAGramos, gramosAKgTexto, pesoValido } from "./peso.ts";

test("kgTextoAGramos: kilos con coma es-CL", () => {
  assert.equal(kgTextoAGramos("1,5"), 1500);
  assert.equal(kgTextoAGramos("0,25"), 250);
  assert.equal(kgTextoAGramos("12"), 12000);
  assert.equal(kgTextoAGramos("0,001"), 1, "un gramo es la resolución mínima");
  assert.equal(kgTextoAGramos("100"), 100000, "el máximo del CHECK de la tabla");
});

test("kgTextoAGramos: NO usa multiplicación flotante — los casos que la delatan", () => {
  // Estos tres son la razón entera de que el parseo sea por texto:
  //   0.1  * 1000 === 100.00000000000001
  //   2.3  * 1000 === 2299.9999999999995
  //   8.11 * 1000 === 8110.000000000001
  // Con Number(x)*1000 el resultado no es entero y formatearKg() lanza RangeError,
  // o peor: se guarda un gramo de menos por pesaje sin que nadie lo note.
  assert.equal(kgTextoAGramos("0,1"), 100);
  assert.equal(kgTextoAGramos("2,3"), 2300);
  assert.equal(kgTextoAGramos("8,11"), 8110);
  for (const kg of ["0,1", "2,3", "8,11", "0,7", "29,4"]) {
    assert.ok(Number.isInteger(kgTextoAGramos(kg)), `${kg} debe dar un entero exacto`);
  }
});

test("kgTextoAGramos: casos que produce el teclado propio", () => {
  assert.equal(kgTextoAGramos(""), 0, "campo vacío = 0, no NaN");
  assert.equal(kgTextoAGramos("0,"), 0, "el teclado escribe '0,' al tocar la coma primero");
  assert.equal(kgTextoAGramos("1,"), 1000, "coma sin decimales todavía");
  assert.equal(kgTextoAGramos("1.5"), 1500, "punto también, por si llega de una báscula");
});

test("kgTextoAGramos: rechaza lo que no es un peso", () => {
  assert.throws(() => kgTextoAGramos("1,2345"), /3 decimales/, "más fino que el gramo no existe");
  assert.throws(() => kgTextoAGramos("1,2,3"), /mal formado/);
  assert.throws(() => kgTextoAGramos("abc"), /mal formado/);
  assert.throws(() => kgTextoAGramos("-5"), /mal formado/, "no hay pesos negativos");
});

test("pesoValido: los límites del CHECK de pan.pesajes", () => {
  assert.equal(pesoValido(0), false, "cero no es un pesaje");
  assert.equal(pesoValido(1), true);
  assert.equal(pesoValido(100000), true);
  assert.equal(pesoValido(100001), false, "sobre 100 kg lo rebota la BD");
  assert.equal(pesoValido(1.5), false, "gramos fraccionarios no existen en la tabla");
});

test("gramosAKgTexto: ida y vuelta sin perder nada", () => {
  assert.equal(gramosAKgTexto(1500), "1,5");
  assert.equal(gramosAKgTexto(12000), "12", "sin decimales colgando");
  assert.equal(gramosAKgTexto(250), "0,25");
  assert.equal(gramosAKgTexto(1), "0,001");
  for (const g of [1, 250, 1500, 8110, 12000, 100000]) {
    assert.equal(kgTextoAGramos(gramosAKgTexto(g)), g, `${g} g debe sobrevivir la ida y vuelta`);
  }
});
