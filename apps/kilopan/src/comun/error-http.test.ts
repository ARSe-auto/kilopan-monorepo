import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarError } from "./error-http.ts";

// AC-SEC-10. Lo que estos casos protegen no es cosmético: `enviarOEncolar` (pod/outbox.ts)
// trata un 5xx como «el servidor está caído, reintento» y un 4xx como «este dato no lo va a
// aceptar nunca, va a la bandeja». Clasificar un dato inválido como 500 deja una venta
// reintentándose para siempre contra un error que no se arregla solo; clasificar una caída
// real como 400 la manda a la bandeja y el operador la da por perdida.

function errorPg(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

test("un CHECK violado es 400 con el mensaje de la BD, no un 500 mudo [AC-SEC-10]", () => {
  const r = clasificarError(
    errorPg("23514", "no se puede mermar más de lo disponible"),
    "No se pudo registrar el pesaje"
  );
  assert.equal(r.estado, 400);
  // El mensaje de la BD llega al operador: lo escribimos nosotros en el trigger, en
  // español y pensado para leerse en pantalla. Taparlo con el genérico es perder la
  // única pista accionable.
  assert.match(r.mensaje, /no se puede mermar/);
});

test("un duplicado (unique_violation) es 400, no 500 [AC-SEC-10]", () => {
  assert.equal(clasificarError(errorPg("23505", "ya hay un turno abierto"), "x").estado, 400);
});

test("una FK rota es 400 — apunta a algo que no existe, es dato del cliente [AC-SEC-10]", () => {
  assert.equal(clasificarError(errorPg("23503", "cliente inexistente"), "x").estado, 400);
});

test("un uuid malformado es 400, no una caída del servidor [AC-SEC-10]", () => {
  assert.equal(clasificarError(errorPg("22P02", 'sintaxis de entrada no válida para uuid: "abc"'), "x").estado, 400);
});

test("el raise exception de nuestros triggers de negocio es 400 [AC-SEC-10]", () => {
  const r = clasificarError(errorPg("P0001", "la entrega ya está cerrada"), "x");
  assert.equal(r.estado, 400);
  assert.match(r.mensaje, /ya está cerrada/);
});

// EL CONTROL EN NEGATIVO, que es el que impide que esto degenere en «todo es 400»: una
// caída de verdad tiene que seguir siendo 500, y con el mensaje genérico — no se filtra
// al cliente el detalle interno de una excepción que no esperábamos.
test("una excepción de verdad sigue siendo 500 y NO filtra el detalle interno [AC-SEC-10]", () => {
  const r = clasificarError(new Error("connect ECONNREFUSED 127.0.0.1:5432"), "No se pudo registrar el pesaje");
  assert.equal(r.estado, 500);
  assert.equal(r.mensaje, "No se pudo registrar el pesaje");
  assert.doesNotMatch(r.mensaje, /ECONNREFUSED/);
});

test("un error de Postgres SIN código conocido también es 500 [AC-SEC-10]", () => {
  assert.equal(clasificarError(errorPg("53300", "too many connections"), "generico").estado, 500);
});

test("la sesión vencida es 401, no 400: el dato estaba bien, falta la credencial [AC-SEC-10]", () => {
  const r = clasificarError(new Error("sin sesión de operador viva"), "x");
  assert.equal(r.estado, 401);
  assert.equal(r.mensaje, "Sesión vencida");
});

test("algo que no es Error tampoco rompe el clasificador [AC-SEC-10]", () => {
  assert.equal(clasificarError("caos", "generico").estado, 500);
});
