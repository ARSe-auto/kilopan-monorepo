import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluarCajaCustodiaLiquidacion,
  type HechosCajaCustodiaLiquidacion,
} from "./semaforo-caja-custodia.ts";

// Dominio Caja/custodia/liquidación [AC-FSEM-17] — spec 05 §2.5, Anexo B.

const RECORD_TIME = new Date("2026-08-12T14:00:00-04:00");

function hechosBase(): HechosCajaCustodiaLiquidacion {
  return {
    discrepanciasPendientes: [],
    cierresDescuadradosSinEvidencia: [],
    lineasDisputadas: [],
    totalOperaciones: 5,
  };
}

test("discrepancia de custodia pendiente ⇒ amarillo", () => {
  const estado = evaluarCajaCustodiaLiquidacion({
    ...hechosBase(),
    discrepanciasPendientes: [
      { id: "d1", quien: "Farmacia del Centro", cuanto: "3 bultos", recordTime: RECORD_TIME },
    ],
  });
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.que, "Discrepancia de custodia pendiente");
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("descuadre confirmado sin evidencia ⇒ rojo", () => {
  const estado = evaluarCajaCustodiaLiquidacion({
    ...hechosBase(),
    cierresDescuadradosSinEvidencia: [
      { id: "c1", quien: "Ruta madrugada 12-ago", cuanto: "$15.000 sin respaldo", recordTime: RECORD_TIME },
    ],
  });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.que, "Descuadre sin evidencia");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("línea disputada ⇒ rojo (dinero disputado siempre es rojo, Anexo B)", () => {
  const estado = evaluarCajaCustodiaLiquidacion({
    ...hechosBase(),
    lineasDisputadas: [
      { id: "l1", quien: "Distribuidora Andes", cuanto: "$45.000 disputados", recordTime: RECORD_TIME },
    ],
  });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.que, "Línea disputada");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("nada pendiente ⇒ verde, agregado completo", () => {
  const estado = evaluarCajaCustodiaLiquidacion(hechosBase());
  assert.equal(estado.color, "verde");
  assert.deepEqual(estado.agregado, { numerador: 5, denominador: 5 });
  assert.equal(estado.excepciones.length, 0);
});

test("el color de la tarjeta es el PEOR entre las tres señales", () => {
  const estado = evaluarCajaCustodiaLiquidacion({
    discrepanciasPendientes: [
      { id: "d2", quien: "Minimarket Sur", cuanto: "1 bulto", recordTime: RECORD_TIME },
    ],
    cierresDescuadradosSinEvidencia: [],
    lineasDisputadas: [
      { id: "l2", quien: "Farmacia del Centro", cuanto: "$8.000 disputados", recordTime: RECORD_TIME },
    ],
    totalOperaciones: 5,
  });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 2);
});

test("«liquidación observada» (amarillo, Anexo B) NO se implementa — CONDICIONADA a la pregunta 11: el tipo de hechos no trae ese campo", () => {
  const hechos = hechosBase();
  assert.deepEqual(Object.keys(hechos).sort(), [
    "cierresDescuadradosSinEvidencia",
    "discrepanciasPendientes",
    "lineasDisputadas",
    "totalOperaciones",
  ]);
});

// «Con liquidación OFF esas señales no evalúan» (§5.5) [AC-FSEM-17]: la gatilla vive en
// `dominioSemaforoActivo("caja_custodia_liquidacion", entitlements)` (`dominio/semaforo.ts`,
// AC-FSEM-13) — probada ON/OFF/sin-configurar en `semaforo.test.ts` (test «caja_custodia_
// liquidacion deja de evaluar cuando la config congelada apaga liquidacion_por_cliente»); este
// evaluador es puro y el orquestador la llama ANTES de invocarlo, así que no se repite acá.
