import test from "node:test";
import assert from "node:assert/strict";
import { FORMATOS } from "./constants.ts";
import { fechaEsCl, horaEsCl, diaDeSemanaEsCl, lunesDeLaSemana, dineroEsCl } from "./fechas.ts";

// Mutantes del formato es-CL [AC-FVEH-07] — §0 (Formatos).
//
// Lo que estos casos protegen: que el día vaya PRIMERO. En un país que escribe el día primero,
// un `mm-dd-aaaa` colado no lo nota nadie hasta que un camión sale un mes tarde — y ese día ya
// no hay forma de saber cuántas agendas se leyeron mal.

/** Un instante sin ambigüedad posible: el día y el mes son distintos y ninguno pasa de 12. */
const TRES_DE_ABRIL = new Date("2026-04-03T15:30:00Z");

test("la fecha va dd-mm-aaaa, con el día primero", () => {
  assert.equal(fechaEsCl(TRES_DE_ABRIL), "03-04-2026");
});

test("el formato declarado en el §0 es el que se produce", () => {
  // Se compara contra la FORMA declarada en la familia canónica y no contra una cadena escrita
  // a mano: si el dueño cambiara el formato del §0, este test tiene que enterarse.
  const forma = fechaEsCl(TRES_DE_ABRIL)
    .replace(/\d{4}/, "aaaa")
    .replace(/^\d{2}/, "dd")
    .replace(/-\d{2}-/, "-mm-");
  assert.equal(forma, FORMATOS.ejemplo_fecha);
});

test("no aparece ni una barra: la fecha chilena va con guiones", () => {
  assert.ok(!fechaEsCl(TRES_DE_ABRIL).includes("/"));
});

test("la hora va en 24 horas, sin «a. m.» ni «p. m.»", () => {
  // A las cinco de la mañana en un galpón nadie quiere resolver un sufijo.
  const hora = horaEsCl(new Date("2026-04-03T23:05:00Z"));
  assert.match(hora, /^\d{2}:\d{2}$/, hora);
});

test("el huso es el de Chile y no el del proceso", () => {
  // Las 02:00 UTC del día 4 son las 22:00 del día 3 en Santiago. Con el huso del servidor, la
  // agenda de la noche entera se leería corrida un día.
  assert.equal(fechaEsCl(new Date("2026-04-04T02:00:00Z")), "03-04-2026");
});

test("el día de la semana sale en español", () => {
  assert.match(diaDeSemanaEsCl(TRES_DE_ABRIL), /viernes/i);
});

test("la semana empieza el LUNES, como la que cuenta la EEVD", () => {
  // Si acá empezara el domingo, la agenda y la métrica norte estarían hablando de semanas
  // distintas con el mismo nombre — y el panel de §10 mostraría una EEVD que no cuadra con lo
  // que el operador ve en pantalla.
  assert.equal(fechaEsCl(lunesDeLaSemana(TRES_DE_ABRIL)), "30-03-2026");
});

test("el lunes de un lunes es él mismo", () => {
  const lunes = new Date("2026-03-30T18:00:00Z");
  assert.equal(fechaEsCl(lunesDeLaSemana(lunes)), "30-03-2026");
});

test("el lunes de un domingo es el lunes ANTERIOR, no el siguiente", () => {
  // El mutante clásico del cálculo con `getDay()`: con el domingo en 0 sin corregir, la semana
  // del domingo salta seis días hacia adelante.
  const domingo = new Date("2026-04-05T18:00:00Z");
  assert.equal(fechaEsCl(lunesDeLaSemana(domingo)), "30-03-2026");
});

// ─── Dinero es-CL [AC-FVEH-13] ───────────────────────────────────────────────────────

test("el dinero va con el separador de miles chileno, no con coma", () => {
  // `$12,500` en Chile se lee como doce pesos con medio. El ejemplo canónico del §0 es el
  // oráculo, y se compara contra ÉL y no contra una cadena escrita a mano.
  const formateado = dineroEsCl(12_500);
  assert.match(formateado, /12\.500/, formateado);
  assert.ok(!formateado.includes("12,500"), formateado);
  assert.match(formateado, /\$/, formateado);
});

test("no hay centavos: en CLP el decimal es un total que no cuadra", () => {
  assert.equal(dineroEsCl(12_500.4).includes(","), false);
  assert.match(dineroEsCl(12_500.6), /12\.501/);
});

test("el cero se muestra, no se esconde", () => {
  // Un monto de cero es información —«esta semana no se cargó»— y ocultarlo se lee como un
  // error de la app.
  assert.match(dineroEsCl(0), /0/);
});
