#!/usr/bin/env node
// Mutantes del lector de TAP [AC-FTEN-08].
//
// El arnés de pgTAP es un intérprete de la salida de otro programa, y esa es la clase de
// pieza que se rompe hacia el verde: si lee mal, una suite en rojo se reporta 0/0 y el gate
// pasa. Acá se prueba justamente eso — que un `not ok` no se lea como ok, y que «cero
// pruebas» no sea silencio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerTap, suitesDe } from "./pgtap.mjs";

test("[AC-FTEN-08] una corrida limpia se cuenta entera", () => {
  const r = leerTap(["1..2", "ok 1 - la PK es uuid", "ok 2 - se puebla con uuidv7()"]);
  assert.deepEqual(r, { total: 2, ok: 2, fallidos: [], diagnosticos: [] });
});

test("[AC-FTEN-08] un `not ok` NO se lee como ok: el prefijo se ancla al principio", () => {
  // `ok` es subcadena de `not ok`. Un match sin anclar da 3/3 verdes sobre una suite en rojo.
  const r = leerTap(["ok 1 - una", "not ok 2 - la PK sigue siendo bigint", "ok 3 - tres"]);
  assert.equal(r.total, 3);
  assert.equal(r.ok, 2);
  assert.deepEqual(r.fallidos, ["la PK sigue siendo bigint"]);
});

test("[AC-FTEN-08] los diagnósticos de pgTAP se conservan: sin ellos el rojo no dice por qué", () => {
  const r = leerTap(["not ok 1 - x", "#         have: bigint", "#         want: uuid"]);
  assert.deepEqual(r.diagnosticos, ["#         have: bigint", "#         want: uuid"]);
});

test("[AC-FTEN-08] una suite que no corrió da 0 pruebas, y el CLI trata el 0 como rojo", () => {
  // El plan a propósito NO se usa para contar: un `finish()` que nunca llega porque una
  // consulta murió dejaría el «1..16» escrito y ni una prueba corrida.
  assert.deepEqual(leerTap(["1..16"]), { total: 0, ok: 0, fallidos: [], diagnosticos: [] });
});

test("[AC-FTEN-08] una salida que llega en un solo bloque con saltos de línea se cuenta igual", () => {
  // pgTAP devuelve varias líneas en UNA fila cuando la función emite un bloque.
  const r = leerTap("ok 1 - una\nnot ok 2 - dos\nok 3 - tres".split("\n"));
  assert.equal(r.total, 3);
  assert.deepEqual(r.fallidos, ["dos"]);
});

test("[AC-FTEN-08] hay al menos una suite pgTAP en el repo: el arnés no corre en el vacío", () => {
  assert.ok(suitesDe().length > 0, "db/flota/pgtap/ está vacío y el gate diría VERDE");
});
