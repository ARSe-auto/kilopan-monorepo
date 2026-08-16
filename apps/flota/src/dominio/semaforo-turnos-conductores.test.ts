import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluarTurnosConductores,
  type HechosTurnosConductores,
  type SenalSinEventoDeTurno,
  type TurnoSinCerrarTrasBloque,
  type TurnoCruzandoMedianoche,
} from "./semaforo-turnos-conductores.ts";
import type { UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Dominio Turnos/conductores [AC-FSEM-08] — spec 05 §2.5, Anexo B.
//
// Umbrales del seed real (migración 0059_seed_anexo_b_semaforo.sql, fila
// `sin_senal_minutos`): amarillo 30 min, rojo 120 min (2 h), recuperación 15 min. Los fixtures
// de este test usan valores robustos a la pregunta 5a (el punto exacto del rango del Anexo B
// «30–45 min»): 65 min supera cualquier amarillo posible sin alcanzar ningún rojo posible, y
// 2,5 h (150 min) supera cualquier rojo posible — mismo criterio que AC-FSEM-07/11/19.
const UMBRALES: UmbralesHisteresis = { umbral_amarillo: 30, umbral_rojo: 120, umbral_recuperacion: 15 };

const RECORD_TIME = new Date("2026-08-12T14:00:00-04:00");

function hechosBase(): HechosTurnosConductores {
  return {
    umbrales: UMBRALES,
    colorPrevioSinEvento: "verde",
    sinEvento: [],
    sinCerrarTrasBloque: [],
    cruzandoMedianoche: [],
    totalTurnos: 5,
  };
}

test("sin eventos 65 min en turno ⇒ amarillo", () => {
  const sinEvento: SenalSinEventoDeTurno[] = [
    { turnoId: "t1", quien: "Conductor Pérez", minutosSinEvento: 65, turnoAbierto: true, recordTime: RECORD_TIME },
  ];
  const estado = evaluarTurnosConductores({ ...hechosBase(), sinEvento });
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("turno sin cerrar >1 h tras fin de bloque ⇒ amarillo", () => {
  const sinCerrarTrasBloque: TurnoSinCerrarTrasBloque[] = [
    { turnoId: "t2", quien: "Conductor Soto", minutosTrasFinDeBloque: 70, recordTime: RECORD_TIME },
  ];
  const estado = evaluarTurnosConductores({ ...hechosBase(), sinCerrarTrasBloque });
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones[0]!.que, "Turno sin cerrar tras fin de bloque");
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("sin señal >2 h ⇒ rojo (fixture 2,5 h)", () => {
  const sinEvento: SenalSinEventoDeTurno[] = [
    { turnoId: "t3", quien: "Conductor Rojas", minutosSinEvento: 150, turnoAbierto: true, recordTime: RECORD_TIME },
  ];
  const estado = evaluarTurnosConductores({ ...hechosBase(), sinEvento });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("turno abierto cruzando medianoche ⇒ rojo", () => {
  const cruzandoMedianoche: TurnoCruzandoMedianoche[] = [
    { turnoId: "t4", quien: "Conductor Muñoz", recordTime: RECORD_TIME },
  ];
  const estado = evaluarTurnosConductores({ ...hechosBase(), cruzandoMedianoche });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.que, "Turno abierto cruzando medianoche");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("turno CERRADO con métrica alta no evalúa — no es excepción", () => {
  const sinEvento: SenalSinEventoDeTurno[] = [
    { turnoId: "t5", quien: "Conductor Vidal", minutosSinEvento: 500, turnoAbierto: false, recordTime: RECORD_TIME },
  ];
  const estado = evaluarTurnosConductores({ ...hechosBase(), sinEvento });
  assert.equal(estado.color, "verde");
  assert.equal(estado.excepciones.length, 0);
});

test("sin ninguna excepción ⇒ verde, agregado completo", () => {
  const estado = evaluarTurnosConductores(hechosBase());
  assert.equal(estado.color, "verde");
  assert.deepEqual(estado.agregado, { numerador: 5, denominador: 5 });
});

test("el color de la tarjeta es el PEOR entre las tres señales", () => {
  const sinCerrarTrasBloque: TurnoSinCerrarTrasBloque[] = [
    { turnoId: "t6", quien: "Conductor Fuentes", minutosTrasFinDeBloque: 65, recordTime: RECORD_TIME },
  ];
  const cruzandoMedianoche: TurnoCruzandoMedianoche[] = [
    { turnoId: "t7", quien: "Conductor Araya", recordTime: RECORD_TIME },
  ];
  const estado = evaluarTurnosConductores({ ...hechosBase(), sinCerrarTrasBloque, cruzandoMedianoche });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 2);
});
