import test from "node:test";
import assert from "node:assert/strict";
import {
  diferenciaDe,
  cuadra,
  puedeCerrar,
  descuadradas,
  clasificar,
  flagsDelCierre,
  DESTINOS_DEL_DESCUADRE,
  FLAG_DESCUADRADO,
  type TerminosDeEmpresa,
} from "./cierre.ts";

// Mutantes de la ecuación de cierre por empresa [AC-FRUT-11] — §3.E1.6, §4.5, §5.2 F5, §4.2.
//
// Lo que se protege acá es que «no cierra descuadrada» siga significando algo. Es una regla que
// se afloja sola: el día que una ruta no cierre por dos bultos y alguien tenga que irse a las
// nueve de la noche, la tentación es dejar pasar «casi cuadra». Estos mutantes son lo que hace
// que aflojarla salga rojo.

const empresa = (partes: Partial<TerminosDeEmpresa> = {}): TerminosDeEmpresa => ({
  empresa_cliente_id: "11111111-1111-7111-8111-111111111111",
  empresa: "Panadería del barrio",
  cargado: 10,
  entregado: 10,
  devuelto: 0,
  faltante: 0,
  ...partes,
});

// ─── La ecuación, y sus dos lados ──────────────────────────────────────────────────

test("cuadra cuando cargado = entregado + devuelto + faltante [AC-FRUT-11]", () => {
  assert.equal(diferenciaDe(empresa({ cargado: 10, entregado: 7, devuelto: 2, faltante: 1 })), 0);
  assert.ok(cuadra(empresa({ cargado: 10, entregado: 7, devuelto: 2, faltante: 1 })));
});

test("los tres términos de la derecha suman, ninguno se ignora [AC-FRUT-11]", () => {
  // Un mutante que se olvide de `devuelto` o de `faltante` cuadra igual cuando ese término es
  // cero — que es el caso de la mayoría de los días. Por eso cada uno se mueve por separado.
  for (const termino of ["entregado", "devuelto", "faltante"] as const) {
    const t = empresa({ cargado: 9, entregado: 3, devuelto: 3, faltante: 3 });
    assert.ok(cuadra(t), `el caso base tiene que cuadrar antes de mover ${termino}`);
    assert.ok(!cuadra({ ...t, [termino]: t[termino] + 1 }));
  }
});

test("la diferencia NEGATIVA es un descuadre, no un cierre limpio [AC-FRUT-11]", () => {
  // Se declaró o se entregó más de lo que subió: pasa cuando el andén contó de menos. Tratarlo
  // como «cuadra» dejaría entrar precisamente el error que más se repite.
  const t = empresa({ cargado: 10, entregado: 12 });
  assert.equal(diferenciaDe(t), -2);
  assert.ok(!cuadra(t));
});

// ─── La ruta no cierra descuadrada (§5.2 F5) ───────────────────────────────────────

test("una sola empresa descuadrada frena el cierre de toda la ruta [AC-FRUT-11]", () => {
  const terminos = [empresa(), empresa({ empresa_cliente_id: "b", cargado: 8, entregado: 5 })];
  assert.ok(!puedeCerrar(terminos));
  assert.deepEqual(
    descuadradas(terminos).map((t) => t.empresa_cliente_id),
    ["b"],
  );
});

test("una ruta sin empresas cuadra: no hay nada que reconciliar [AC-FRUT-11]", () => {
  assert.ok(puedeCerrar([]));
  assert.deepEqual(flagsDelCierre([]), []);
});

// ─── La clasificación táctil del descuadre (§5.2 F5) ───────────────────────────────

test("clasificar asigna TODA la diferencia al término elegido y deja la ruta cuadrada", () => {
  for (const destino of DESTINOS_DEL_DESCUADRE) {
    const antes = empresa({ cargado: 10, entregado: 6 });
    const despues = clasificar(antes, destino);
    assert.equal(despues[destino], 4, `${destino} tiene que quedar con la diferencia entera`);
    assert.ok(cuadra(despues));
    // El otro término no se toca: clasificar a `devuelto` no puede inventar un faltante.
    const otro = destino === "devuelto" ? "faltante" : "devuelto";
    assert.equal(despues[otro], antes[otro]);
  }
});

test("clasificar dos veces reparte el descuadre sin sorpresas [AC-FRUT-11]", () => {
  // Quien tenga que partir la diferencia toca dos veces, y para eso esta función se aplica
  // sobre su propio resultado. El segundo toque no puede volver a asignar lo ya asignado.
  const primero = clasificar(empresa({ cargado: 10, entregado: 4, devuelto: 2 }), "devuelto");
  assert.equal(primero.devuelto, 6);
  assert.equal(clasificar(primero, "faltante").faltante, 0);
  assert.ok(cuadra(primero));
});

test("con diferencia negativa clasificar no toca nada [AC-FRUT-11]", () => {
  // Restar dejaría un `devuelto` negativo que la base rechaza por CHECK. Ese descuadre se
  // arregla corrigiendo el conteo, no clasificándolo.
  const t = empresa({ cargado: 5, entregado: 9 });
  for (const destino of DESTINOS_DEL_DESCUADRE) assert.deepEqual(clasificar(t, destino), t);
});

// ─── En el servidor jamás rebota: entra con su flag (§4.2) ─────────────────────────

test("el cierre descuadrado deja flag, y el cuadrado no deja ninguno [AC-FRUT-11]", () => {
  assert.deepEqual(flagsDelCierre([empresa()]), []);
  assert.deepEqual(flagsDelCierre([empresa({ entregado: 3 })]), [FLAG_DESCUADRADO]);
  // Marcar de más también rompe: la cola «Por revisar» del §5.6 tiene que tender a cero, y una
  // bandeja que amanece con cien filas deja de mirarse en una semana.
  assert.equal(flagsDelCierre([empresa(), empresa({ empresa_cliente_id: "b" })]).length, 0);
});

// ─── Ni un solo CLP en el flujo del chofer (§4.8, §5.2 F5) ─────────────────────────

test("los términos del cierre son bultos: ningún campo de dinero [AC-FRUT-11]", () => {
  const claves = Object.keys(empresa());
  for (const clave of claves) {
    assert.ok(
      !/clp|precio|monto|tarifa|total_pesos|importe/i.test(clave),
      `«${clave}» huele a dinero, y el chofer jamás ve CLP (§4.8)`,
    );
  }
});
