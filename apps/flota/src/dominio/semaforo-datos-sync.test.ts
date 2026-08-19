import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluarDatosSync,
  colorDeSeveridad,
  type HechosDatosSync,
  type OutboxDeDispositivo,
  type ParadaSinEvidenciaTrasSync,
  type ExcepcionReviewQueueDatosSync,
} from "./semaforo-datos-sync.ts";
import type { UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Dominio Datos/sync [AC-FSEM-07] — spec 05 §2.4/§2.5, Anexo B.
//
// Umbrales del seed real (migración 0059_seed_anexo_b_semaforo.sql, fila
// `outbox_cola_edad_max_min`): amarillo 30 min, rojo 180 min (3 h), recuperación 15 min. Los
// fixtures de este test usan valores robustos a la pregunta 5a (el punto exacto del rango del
// Anexo B «30–60 min» / «3–4 h»): 65 min supera cualquier amarillo posible sin alcanzar ningún
// rojo posible, y 4 h (240 min) supera cualquier rojo posible — así el test no depende de qué
// responda esa pregunta, mismo criterio que ya usan AC-FSEM-08/11/19.
const UMBRALES: UmbralesHisteresis = { umbral_amarillo: 30, umbral_rojo: 180, umbral_recuperacion: 15 };

const RECORD_TIME = new Date("2026-08-12T14:00:00-04:00");

function hechosBase(): HechosDatosSync {
  return {
    umbrales: UMBRALES,
    colorPrevioOutbox: "verde",
    outbox: [],
    paradasSinEvidencia: [],
    excepcionesReviewQueue: [],
    totalDispositivos: 5,
  };
}

test("outbox_edad_max 65 min en turno ⇒ amarillo", () => {
  const outbox: OutboxDeDispositivo[] = [
    { dispositivoId: "d1", quien: "Furgón AA11", edadMaxMin: 65, turnoAbierto: true, recordTime: RECORD_TIME },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), outbox });
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("sin sync >4 h con turno abierto ⇒ rojo", () => {
  const outbox: OutboxDeDispositivo[] = [
    { dispositivoId: "d1", quien: "Furgón CC33", edadMaxMin: 4 * 60 + 1, turnoAbierto: true, recordTime: RECORD_TIME },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), outbox });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("outbox viejo con turno CERRADO no evalúa — no es excepción", () => {
  const outbox: OutboxDeDispositivo[] = [
    { dispositivoId: "d1", quien: "Furgón DD44", edadMaxMin: 500, turnoAbierto: false, recordTime: RECORD_TIME },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), outbox });
  assert.equal(estado.color, "verde");
  assert.equal(estado.excepciones.length, 0);
});

test("parada `done` sin fila en evidence tras sync ⇒ rojo", () => {
  const paradasSinEvidencia: ParadaSinEvidenciaTrasSync[] = [
    { paradaId: "parada-214", quien: "Parada 214", recordTime: RECORD_TIME },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), paradasSinEvidencia });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.que, "Entrega sin evidencia tras sync");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("hueco de secuencia por dispositivo (§4.7) ⇒ rojo, aunque su severidad de captura sea `media`", () => {
  // `severidadDeFlag("secuencia_hueco")` (dominio/pod-sync.ts, AC-FPOD-10) devuelve `media` —
  // la captura degradada entró 2xx y aterrizó en `review_queue` con esa severidad de triage. El
  // Anexo B igual la clasifica rojo en la tarjeta del semáforo: dos escalas distintas, y este AC
  // es el que las concilia (ver comentario de cabecera de semaforo-datos-sync.ts).
  const excepcionesReviewQueue: ExcepcionReviewQueueDatosSync[] = [
    {
      id: "rq-1",
      origen: "entrega.secuencia_hueco",
      severidad: "media",
      estado: "nueva",
      quien: "Dispositivo del despacho 3",
      recordTime: RECORD_TIME,
    },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), excepcionesReviewQueue });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("la captura degradada que originó el flag aparece como excepción del dominio, no como error aparte", () => {
  const excepcionesReviewQueue: ExcepcionReviewQueueDatosSync[] = [
    {
      id: "rq-1",
      origen: "entrega.secuencia_hueco",
      severidad: "media",
      estado: "nueva",
      quien: "Dispositivo del despacho 3",
      recordTime: RECORD_TIME,
    },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), excepcionesReviewQueue });
  // Misma forma (`ExcepcionCruda`, con playbook y quien/que/cuánto) que cualquier otra excepción
  // del dominio — la fila de «Por revisar» se lee como una excepción más, no como un estado de
  // error separado del dispositivo.
  const excepcion = estado.excepciones[0]!;
  assert.equal(excepcion.id, "rq-1");
  assert.equal(excepcion.estado, "nueva");
  assert.ok(excepcion.playbook && excepcion.playbook.length > 0);
  assert.ok(excepcion.quien);
});

test("review_queue con severidad `alta` (post_revocacion_tardia) se proyecta ROJA — proyección severidad→{amarillo, rojo}", () => {
  const excepcionesReviewQueue: ExcepcionReviewQueueDatosSync[] = [
    {
      id: "rq-2",
      origen: "entrega.post_revocacion_tardia",
      severidad: "alta",
      estado: "nueva",
      quien: "Furgón revocado EE55",
      recordTime: RECORD_TIME,
    },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), excepcionesReviewQueue });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("colorDeSeveridad: alta ⇒ rojo, cualquier otra ⇒ amarillo, sin ambigüedad", () => {
  assert.equal(colorDeSeveridad("alta"), "rojo");
  assert.equal(colorDeSeveridad("media"), "amarillo");
  assert.equal(colorDeSeveridad("baja"), "amarillo");
});

test("sin ninguna excepción ⇒ verde, agregado completo", () => {
  const estado = evaluarDatosSync(hechosBase());
  assert.equal(estado.color, "verde");
  assert.deepEqual(estado.agregado, { numerador: 5, denominador: 5 });
});

test("el color de la tarjeta es el PEOR entre las tres familias de hechos", () => {
  const outbox: OutboxDeDispositivo[] = [
    { dispositivoId: "d1", quien: "Furgón AA11", edadMaxMin: 65, turnoAbierto: true, recordTime: RECORD_TIME },
  ];
  const paradasSinEvidencia: ParadaSinEvidenciaTrasSync[] = [
    { paradaId: "parada-9", quien: "Parada 9", recordTime: RECORD_TIME },
  ];
  const estado = evaluarDatosSync({ ...hechosBase(), outbox, paradasSinEvidencia });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 2);
});
