#!/usr/bin/env node
// Mutantes del gate de la matriz KiloRuta [AC-FTEN-19] — §9.1(4)(a).
//
// El AC nombra tres verificaciones y un caso de rebote por cada una: ID duplicado, ID faltante
// y test inexistente. Acá está cada uno contra el fixture que lo produce, más los dos que el AC
// no nombra y que son los que de verdad matan a un gate de este tipo: el verde vacuo (ninguna
// fila con test) y la fila pendiente sin declarar (un guion suelto se lee igual que un olvido).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { auditar, leerN, leerFilas, referenciaDe } from "./gate-matriz-kiloruta.mjs";

const LISTA = (n) => `Lista de prueba.\n\nN = ${n}\n\nMás texto.\n`;
const fila = (id, test_) => `| ${id} | alguna_tabla | ${test_} |`;
const MATRIZ = (filas) => `# Matriz\n\n| ID | tabla | test |\n|---|---|---|\n${filas.join("\n")}\n`;

/** Existe todo, para que los mutantes de arriba no fallen por el motivo equivocado. */
const todoExiste = () => true;

const juzgar = (n, filas, existeTest = todoExiste) =>
  auditar({ textoLista: LISTA(n), textoMatriz: MATRIZ(filas), existeTest }).problemas;

const conTest = (id) => fila(id, "ruta/x.test.mjs::un nombre de prueba");
// El id del AC va sin la forma «AC-FXXX-NN» a propósito: `verify-refs` recorre el árbol
// entero buscando ACs citados, y un id inventado dentro de un fixture le haría reportar un AC
// que ninguna spec define. El gate mira la CLASE declarada, no el formato del id.
const pendiente = (id) => fila(id, "— (pendiente: el AC que lo cierra · hito z)");

test("[AC-FTEN-19] la matriz completa y coherente pasa (el gate no es un no-op al revés)", () => {
  assert.deepEqual(juzgar(3, [conTest("KR-01"), pendiente("KR-02"), pendiente("KR-03")]), []);
});

test("[AC-FTEN-19] count(filas) != N ⇒ rojo, y la N sale de la LISTA y no de este archivo", () => {
  // Sin esta verificación, borrar una fila deja la compatibilidad afirmada sin respaldo para
  // ese criterio y nadie se entera. La N se lee de la lista congelada a propósito: dos copias
  // de la misma cifra se separan, y la vieja es siempre la que nadie mira.
  const problemas = juzgar(3, [conTest("KR-01"), pendiente("KR-02")]);
  assert.match(problemas.join("\n"), /2 filas y la lista congelada declara N = 3/);
  assert.equal(leerN(LISTA(63)), 63);
  assert.equal(leerN("sin ene"), null);
});

test("[AC-FTEN-19] un ID DUPLICADO ⇒ rojo: un duplicado esconde a un faltante", () => {
  // El caso venenoso: la cuenta da bien y un criterio quedó sin mapear.
  const problemas = juzgar(3, [conTest("KR-01"), pendiente("KR-01"), pendiente("KR-03")]);
  assert.match(problemas.join("\n"), /KR-01 aparece 2 veces/);
  assert.match(problemas.join("\n"), /falta KR-02/);
});

test("[AC-FTEN-19] un ID FUERA del rango de la lista ⇒ rojo", () => {
  const problemas = juzgar(2, [conTest("KR-01"), pendiente("KR-99")]);
  assert.match(problemas.join("\n"), /KR-99 no pertenece al rango/);
});

test("[AC-FTEN-19] un test INEXISTENTE ⇒ rojo, que es el rebote que más importa", () => {
  // Un criterio que apunta a un test borrado o renombrado se lee como cubierto: es peor que uno
  // sin mapear, porque el sin mapear al menos se ve.
  const problemas = juzgar(1, [conTest("KR-01")], () => false);
  assert.match(problemas.join("\n"), /no existe en el repo/);
});

test("[AC-FTEN-19] el fragmento se busca DENTRO del archivo: renombrar el test también rompe", () => {
  const vistos = [];
  juzgar(1, [fila("KR-01", "db/x.test.mjs::el nombre exacto")], (ruta, fragmento) => {
    vistos.push([ruta, fragmento]);
    return true;
  });
  assert.deepEqual(vistos, [["db/x.test.mjs", "el nombre exacto"]]);
});

test("[AC-FTEN-19] CERO filas con test ⇒ rojo: el verde vacuo del gate", () => {
  // Con todas las filas pendientes, la verificación de existencia pasa sin haber comprobado
  // nada. Es el modo de falla natural de una matriz que se llena de a poco.
  const problemas = juzgar(2, [pendiente("KR-01"), pendiente("KR-02")]);
  assert.match(problemas.join("\n"), /ninguna fila referencia un test/);
});

test("[AC-FTEN-19] una fila sin test tiene que DECIR por qué", () => {
  // Un guion suelto se lee igual que un olvido. Las clases admitidas son las de la lista
  // congelada más «pendiente», que es la del AC todavía no construido.
  assert.match(juzgar(2, [conTest("KR-01"), fila("KR-02", "—")]).join("\n"), /no declara por qué/);
  for (const clase of ["pendiente", "bloqueado", "supersedido", "descartado", "diferido"]) {
    assert.deepEqual(juzgar(2, [conTest("KR-01"), fila("KR-02", `— (${clase}: la razón)`)]), []);
  }
});

test("[AC-FTEN-19] el lector de la tabla no confunde el encabezado con una fila", () => {
  const filas = leerFilas(MATRIZ([conTest("KR-01")]));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, "KR-01");
  assert.equal(referenciaDe("— (pendiente: x)"), null);
  assert.deepEqual(referenciaDe("a/b.mjs::nombre"), { ruta: "a/b.mjs", fragmento: "nombre" });
});

test("[AC-FTEN-19] el repo real pasa el gate, con criterios de verdad y tests de verdad", () => {
  const salida = execFileSync("node", [new URL("gate-matriz-kiloruta.mjs", import.meta.url).pathname], {
    encoding: "utf8",
  });
  assert.match(salida, /VERDE/);
  // Anti-vacuidad sobre el repo: si la matriz quedara vacía o sin un solo test verificado, el
  // VERDE de arriba no significaría nada.
  assert.match(salida, /63\/63 criterios mapeados/);
  assert.doesNotMatch(salida, /·\s0 con test verificado/);
});
