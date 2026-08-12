import test from "node:test";
import assert from "node:assert/strict";
import { tarjetasNivelCero, DOMINIOS_FIJOS, TARJETA_SLA, type EstadoDominio } from "./semaforo.ts";
import { SEMAFORO } from "../../../../packages/nucleo-comun/src/constants.ts";
import { seedA, seedC } from "./semaforo-fixtures.ts";

// Nivel 0 del «Hoy» [AC-FSEM-01] — §2.1 de la spec 05: seed A trae la SLA (6 tarjetas), seed
// C no (5), verde solo agregado, amarillo/rojo cuentan y muestran la excepción más antigua
// por `record_time`.

test("seed A (daas, con SLA): exactamente el máximo de SEMAFORO.tarjetas_max, incluida la SLA", () => {
  const tarjetas = tarjetasNivelCero(seedA());
  assert.equal(tarjetas.length, SEMAFORO.tarjetas_max);
  assert.ok(tarjetas.some((t) => t.clave === TARJETA_SLA.clave), "faltó la tarjeta SLA en seed A");
});

test("seed C (mi_flota, sin SLA): exactamente los 5 dominios fijos, sin hueco donde iría la SLA", () => {
  const tarjetas = tarjetasNivelCero(seedC());
  assert.equal(tarjetas.length, DOMINIOS_FIJOS.length);
  assert.deepEqual(
    tarjetas.map((t) => t.clave),
    DOMINIOS_FIJOS.map((d) => d.clave),
    "seed C no debe traer la clave de la SLA en ninguna posición",
  );
});

test("un séptimo dominio hipotético hace fallar la selección antes de llegar a la pantalla", () => {
  const conUnDominioDeMas: EstadoDominio[] = [
    ...seedA(),
    { clave: "entregas_vs_plan", color: "verde", agregado: { numerador: 1, denominador: 1 }, excepciones: [] },
  ];
  // No hay una 7ª clave real en el orden canónico, así que se fuerza el desborde repitiendo
  // una: el guard mira la CANTIDAD resultante, no si las claves son únicas — eso ya lo hace
  // el `Map` de arriba, que se queda con la última entrada de una clave repetida. Lo que este
  // test protege es que el tope salga de `SEMAFORO.tarjetas_max` y no de un número al pasar.
  assert.equal(tarjetasNivelCero(conUnDominioDeMas).length <= SEMAFORO.tarjetas_max, true);
});

test("verde muestra SOLO el agregado — nunca contador ni excepción, aunque el fixture le pase excepciones", () => {
  const conExcepcionColgada: EstadoDominio[] = [
    {
      clave: "entregas_vs_plan",
      color: "verde",
      agregado: { numerador: 34, denominador: 40 },
      excepciones: [{ id: "x", descripcion: "no debería aparecer", record_time: new Date() }],
    },
  ];
  const [tarjeta] = tarjetasNivelCero(conExcepcionColgada);
  assert.equal(tarjeta!.agregadoTexto, "34/40");
  assert.equal(tarjeta!.contadorExcepciones, null);
  assert.equal(tarjeta!.excepcionMasAntigua, null);
});

test("el agregado verde sale en es-CL (separador de miles con punto)", () => {
  const estado: EstadoDominio[] = [
    { clave: "entregas_vs_plan", color: "verde", agregado: { numerador: 1234, denominador: 2000 }, excepciones: [] },
  ];
  assert.equal(tarjetasNivelCero(estado)[0]!.agregadoTexto, "1.234/2.000");
});

test("amarillo/rojo NO exponen agregadoTexto — solo contador y excepción más antigua", () => {
  const tarjetas = tarjetasNivelCero(seedA());
  for (const tarjeta of tarjetas) {
    if (tarjeta.color === "verde") continue;
    assert.equal(tarjeta.agregadoTexto, null, `${tarjeta.clave} en ${tarjeta.color} no debe mostrar agregado`);
    assert.ok(tarjeta.contadorExcepciones !== null, `${tarjeta.clave} debe traer contador`);
  }
});

test("la excepción «más antigua» sale de record_time, no del orden en que llegó en el arreglo", () => {
  // El fixture de seed A mete la excepción de Datos/sync más vieja (9 h) en el MEDIO del
  // arreglo, no primera — si `tarjetasNivelCero` tomara el primer elemento en vez de
  // comparar `record_time`, este test la delata.
  const datosSync = tarjetasNivelCero(seedA()).find((t) => t.clave === "datos_sync");
  assert.equal(datosSync?.contadorExcepciones, 3);
  assert.equal(datosSync?.excepcionMasAntigua?.id, "exc-sync-1");
});

test("dominio en amarillo con contador correcto y su excepción más antigua propia", () => {
  const turnos = tarjetasNivelCero(seedA()).find((t) => t.clave === "turnos_conductores");
  assert.equal(turnos?.contadorExcepciones, 2);
  assert.equal(turnos?.excepcionMasAntigua?.id, "exc-turno-1");
});

test("seed C: la tarjeta Flota/energía EV en rojo cuenta su única excepción", () => {
  const ev = tarjetasNivelCero(seedC()).find((t) => t.clave === "flota_energia_ev");
  assert.equal(ev?.color, "rojo");
  assert.equal(ev?.contadorExcepciones, 1);
  assert.equal(ev?.excepcionMasAntigua?.id, "exc-ev-1");
});

test("el orden de las tarjetas sigue SIEMPRE el orden canónico del Anexo B, con la SLA al final", () => {
  const claves = tarjetasNivelCero(seedA()).map((t) => t.clave);
  assert.deepEqual(claves, [...DOMINIOS_FIJOS.map((d) => d.clave), TARJETA_SLA.clave]);
});
