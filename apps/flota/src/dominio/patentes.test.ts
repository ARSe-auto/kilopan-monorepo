import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizarPatente,
  juzgarPatente,
  normalizarTipo,
  juzgarTipo,
  PATENTE_LARGO_MIN,
  PATENTE_LARGO_MAX,
  TIPO_LARGO_MAX,
} from "./patentes.ts";

// Mutantes de la normalización de patente [AC-FVEH-01].
//
// Lo que estos casos protegen es UNA cosa: que el `UNIQUE (tenant_id, patente)` del §4.5
// signifique «un camión», y no «un camión por cada forma de tipearlo». Si la normalización se
// ablanda, el 422 de patente duplicada del AC deja de dispararse y la base acepta dos filas
// para el mismo vehículo — que es el defecto que no se ve hasta que dos historias de odómetro
// no cuadran, meses después.

// ─── La forma canónica ───────────────────────────────────────────────────────────────

test("las formas de tipear la misma patente colapsan en UNA", () => {
  const formas = ["AB1234", "ab1234", "AB-1234", "ab 1234", " AB.1234 ", "Ab-12 34"];
  const canonicas = new Set(formas.map(normalizarPatente));
  assert.deepEqual([...canonicas], ["AB1234"], "dos formas de la misma patente dieron filas distintas");
});

test("dos patentes DISTINTAS siguen siendo distintas después de normalizar", () => {
  // La otra mitad, sin la cual «colapsan en una» se cumpliría con una función que devuelve
  // siempre lo mismo.
  assert.notEqual(normalizarPatente("AB1234"), normalizarPatente("AB1235"));
  assert.notEqual(normalizarPatente("BBBB12"), normalizarPatente("BBBB13"));
});

test("no queda ni un carácter fuera de letras y dígitos", () => {
  assert.match(normalizarPatente("¡AB-12.34!"), /^[A-Z0-9]+$/);
});

// ─── El veredicto ────────────────────────────────────────────────────────────────────

test("una patente sana pasa y sale ya canónica", () => {
  assert.deepEqual(juzgarPatente(" bc-45 67 "), { tipo: "ok", patente: "BC4567" });
});

test("vacío, solo separadores y solo espacios son la misma respuesta: vacía", () => {
  for (const crudo of ["", "   ", "---", ".- ."]) {
    assert.deepEqual(juzgarPatente(crudo), { tipo: "invalida", motivo: "vacia" }, `«${crudo}»`);
  }
});

test("los bordes del largo: el mínimo entra y uno menos rebota", () => {
  assert.equal(juzgarPatente("A".repeat(PATENTE_LARGO_MIN)).tipo, "ok");
  assert.deepEqual(juzgarPatente("A".repeat(PATENTE_LARGO_MIN - 1)), {
    tipo: "invalida",
    motivo: "corta",
  });
});

test("los bordes del largo: el máximo entra y uno más rebota", () => {
  assert.equal(juzgarPatente("A".repeat(PATENTE_LARGO_MAX)).tipo, "ok");
  assert.deepEqual(juzgarPatente("A".repeat(PATENTE_LARGO_MAX + 1)), {
    tipo: "invalida",
    motivo: "larga",
  });
});

test("el largo se mide DESPUÉS de normalizar, no sobre lo tipeado", () => {
  // «A-B-1-2» tiene siete caracteres tipeados y cuatro reales. Medir antes de limpiar dejaría
  // pasar cualquier cosa con guiones y rebotaría patentes sanas escritas con separadores.
  assert.deepEqual(juzgarPatente("A-B-1-2"), { tipo: "ok", patente: "AB12" });
});

test("la forma que acepta el veredicto es la que acepta el CHECK de la migración", () => {
  // El CHECK de `vehiculos` es `^[A-Z0-9]{4,12}$`. Que el juicio de la app sea MÁS ESTRICTO o
  // igual —nunca más laxo— es lo que evita que un alta válida para la app muera con un error
  // de restricción, que es una pantalla rota en vez de un mensaje que se puede actuar.
  const delCheck = /^[A-Z0-9]{4,12}$/;
  for (const crudo of ["ab1234", "A-B-1-2", "BBBB12", "cd345678"]) {
    const v = juzgarPatente(crudo);
    assert.equal(v.tipo, "ok", crudo);
    if (v.tipo === "ok") assert.match(v.patente, delCheck, crudo);
  }
});

// ─── El tipo ─────────────────────────────────────────────────────────────────────────

test("el tipo conserva su forma: ni mayúsculas ni mapeo contra una lista inventada", () => {
  // El maestro no enumera los chips (spec 02, pregunta 15). Normalizar de más acá sería
  // fabricar un catálogo por la puerta de atrás.
  assert.equal(normalizarTipo("  furgón   eléctrico "), "furgón eléctrico");
  assert.equal(normalizarTipo("Furgón"), "Furgón");
});

test("un tipo vacío rebota, y uno más largo que el techo también", () => {
  assert.deepEqual(juzgarTipo("   "), { tipo: "invalida" });
  assert.deepEqual(juzgarTipo("x".repeat(TIPO_LARGO_MAX + 1)), { tipo: "invalida" });
  assert.deepEqual(juzgarTipo("x".repeat(TIPO_LARGO_MAX)), {
    tipo: "ok",
    valor: "x".repeat(TIPO_LARGO_MAX),
  });
});
