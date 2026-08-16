#!/usr/bin/env node
// Mutantes de la ventana del exportador [AC-FTEN-20].
//
// La ventana alineada al reloj es lo que hace que dos corridas del mismo tramo actualicen UNA
// fila en vez de crear dos. Si la alineación se rompe, el panel cross-tenant se llena de
// filas casi iguales y nadie lo nota hasta que hay que leerlo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ventanaDe } from "./exportar.mjs";
import { EXPORTADOR } from "../../packages/nucleo-comun/src/constants.ts";

const iso = (d) => d.toISOString();

test("[AC-FTEN-20] la ventana se alinea hacia ABAJO al tramo del reloj", () => {
  const { inicio, fin } = ventanaDe(new Date("2026-08-09T10:07:31.842Z"), 5);
  assert.equal(iso(inicio), "2026-08-09T10:05:00.000Z");
  assert.equal(iso(fin), "2026-08-09T10:10:00.000Z");
});

test("[AC-FTEN-20] dos instantes del MISMO tramo dan la MISMA ventana: por eso es un upsert", () => {
  const a = ventanaDe(new Date("2026-08-09T10:05:00.000Z"), 5);
  const b = ventanaDe(new Date("2026-08-09T10:09:59.999Z"), 5);
  assert.equal(iso(a.inicio), iso(b.inicio));
});

test("[AC-FTEN-20] el borde superior pertenece al tramo SIGUIENTE, no al anterior", () => {
  // Si el tramo fuera cerrado por arriba, el instante 10:10:00 caería en dos ventanas y su
  // métrica se contaría dos veces.
  const a = ventanaDe(new Date("2026-08-09T10:09:59.999Z"), 5);
  const b = ventanaDe(new Date("2026-08-09T10:10:00.000Z"), 5);
  assert.notEqual(iso(a.inicio), iso(b.inicio));
  assert.equal(iso(a.fin), iso(b.inicio), "las ventanas tienen que ser contiguas, sin hueco");
});

test("[AC-FTEN-20] la cadencia por omisión es la de la familia de constantes, no un 5 suelto", () => {
  const { inicio, fin } = ventanaDe(new Date("2026-08-09T10:07:31.842Z"));
  assert.equal((fin - inicio) / 60_000, EXPORTADOR.cadencia_min);
});

test("[AC-FTEN-20] la cadencia dictada por el dueño es de 5 minutos (Pregunta 8, 09-ago-2026)", () => {
  // Con 5, los «2 intervalos» del Anexo B son 10 minutos, coherentes con el umbral vecino
  // («errores >5% por 15 min»). Si alguien la cambia, esta prueba lo obliga a mirar el Anexo.
  assert.equal(EXPORTADOR.cadencia_min, 5);
  assert.equal(EXPORTADOR.ventana_alineada_al_reloj, true);
});
