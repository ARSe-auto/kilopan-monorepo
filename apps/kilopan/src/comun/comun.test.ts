import { test } from "node:test";
import assert from "node:assert/strict";
import { roundClp } from "./round_clp.ts";
import { validaRut, calcularDv, formatearRut } from "./valida_rut.ts";
import { formatearKg, formatearClp, formatearFecha, parsearClp } from "./formato.ts";

// --- round_clp (AC-H0 apoyo, invariante "dinero = CLP entero") ---
test("roundClp: redondea hacia abajo/arriba según el decimal", () => {
  assert.equal(roundClp(1499.2), 1499);
  assert.equal(roundClp(1499.7), 1500);
});
test("roundClp: mitad exacta usa redondeo bancario (al par)", () => {
  assert.equal(roundClp(1500.5), 1500); // 1500 es par
  assert.equal(roundClp(1501.5), 1502); // 1501 es impar -> sube al par 1502
});
test("roundClp: rechaza valores no finitos", () => {
  assert.throws(() => roundClp(NaN));
  assert.throws(() => roundClp(Infinity));
});

// --- valida_rut (módulo 11) ---
test("validaRut: acepta RUTs válidos conocidos, con y sin formato", () => {
  assert.equal(validaRut("12.345.678-5"), true);
  assert.equal(validaRut("12345678-5"), true);
  assert.equal(validaRut("123456785"), true);
  assert.equal(validaRut("76.192.083-9"), true); // RUT de empresa real usado como ejemplo de formato
});
test("validaRut: acepta dígito verificador K y 0 (casos límite del módulo 11)", () => {
  assert.equal(calcularDv("10000013"), "K");
  assert.equal(validaRut("10.000.013-K"), true);
  assert.equal(validaRut("10000013-k"), true); // minúscula también
  assert.equal(calcularDv("5000006"), "0");
  assert.equal(validaRut("5.000.006-0"), true);
});
test("validaRut: rechaza dígito verificador incorrecto", () => {
  assert.equal(validaRut("12.345.678-9"), false);
});
test("validaRut: rechaza formato imposible", () => {
  assert.equal(validaRut(""), false);
  assert.equal(validaRut("no-es-un-rut"), false);
  assert.equal(validaRut("12345"), false); // cuerpo demasiado corto
});
test("formatearRut: produce la forma es-CL estándar", () => {
  assert.equal(formatearRut("123456785"), "12.345.678-5");
});

// --- formato es-CL ---
test("formatearKg: coma decimal, 3 decimales desde gramos enteros", () => {
  assert.equal(formatearKg(12450), "12,450 kg");
  assert.equal(formatearKg(1000), "1,000 kg");
});
test("formatearKg: rechaza gramos no enteros (invariante de BD: gramos es integer)", () => {
  assert.throws(() => formatearKg(12450.5));
});
test("formatearClp: punto de miles, sin decimales, entero", () => {
  assert.equal(formatearClp(12500), "$12.500");
  assert.equal(formatearClp(1000000), "$1.000.000");
  assert.equal(formatearClp(500), "$500");
});
test("formatearClp: rechaza CLP no entero (invariante: dinero = CLP integer)", () => {
  assert.throws(() => formatearClp(1250.5));
});
test("parsearClp: quita el punto de miles chileno (reproduce el bug del cierre de caja)", () => {
  assert.equal(parsearClp("45.000"), 45000, "Number(\"45.000\") da 45 — este es el bug que se corrigió");
  assert.equal(parsearClp("1.000.000"), 1000000);
  assert.equal(parsearClp("500"), 500);
});
test("parsearClp: acepta coma decimal y redondea", () => {
  assert.equal(parsearClp("45.000,50"), 45001);
  assert.equal(parsearClp("45.000,49"), 45000);
});
test("parsearClp: vacío o solo espacios es 0", () => {
  assert.equal(parsearClp(""), 0);
  assert.equal(parsearClp("   "), 0);
});
test("formatearFecha: dd-mm-aaaa", () => {
  assert.equal(formatearFecha(new Date(2026, 6, 25)), "25-07-2026"); // mes 6 = julio (0-index)
});
