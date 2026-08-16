import test from "node:test";
import assert from "node:assert/strict";
import { evaluarFlotaEv, type HechosFlotaEv, type SenalTramoVehiculo, type SenalEnchufado } from "./semaforo-flota-ev.ts";
import type { UmbralesHisteresis } from "./semaforo-histeresis.ts";
import { METODOS_DE_ESTIMACION, type MetodoDeEstimacion, type Tramo } from "../../../../packages/nucleo-comun/src/senales-ev.ts";
import { SOC } from "../../../../packages/nucleo-comun/src/constants.ts";

// Dominio Flota/energía EV [AC-FSEM-16] — spec 05 §2.5, Anexo B.
//
// Umbrales del seed real (migración 0059_seed_anexo_b_semaforo.sql, fila
// `soc_margen_reserva_pp`): amarillo 5 pp, rojo 0 pp, recuperación 10 pp — el margen de SOC
// proyectado sobre la reserva del tenant (`reserva_pct` default 15 %, `parametros`).
//
// Cada fixture trae la misma ficha EV fija (autonomía 300 km, SOH 100 %, 200 Wh/km, batería
// 60.000 Wh) y el `kmDelTramo` que hace falta para llegar al consumo deseado se calculó A MANO
// contra la fórmula única (§0, `packages/nucleo-comun/src/energia.ts`) — este archivo no la
// repite en código para no chocar con `gate-formula-energia` (AC-FVEH-09): con esta ficha,
// `consumo% = kmDelTramo / 3` por el método `wh_por_km` y `consumo% = kmDelTramo / 2,55` por
// `rango_efectivo` (rango efectivo = 300 × 1 × 0,85 = 255 km). Cada test que puede correrse con
// los dos métodos se corre con los DOS (pregunta 13 de la spec 02 sigue abierta), mismo criterio
// que `senales-ev.test.ts`.
const UMBRALES_MARGEN: UmbralesHisteresis = { umbral_amarillo: 5, umbral_rojo: 0, umbral_recuperacion: 10 };
const RECORD_TIME = new Date("2026-08-12T14:00:00-04:00");

const FICHA_COMPLETA = {
  autonomiaNominalKm: 300,
  sohPct: SOC.maximo,
  whPorKmBase: 200,
  bateriaWh: 60_000,
};

function tramo(extra: Partial<Tramo> = {}): Tramo {
  return { socActualPct: 80, kmDelTramo: 50, datos: FICHA_COMPLETA, ...extra };
}

function hechosBase(): HechosFlotaEv {
  return {
    umbralesMargen: UMBRALES_MARGEN,
    colorPrevioMargen: "verde",
    tramos: [],
    enchufados: [],
    totalVehiculos: 5,
  };
}

function paraCadaMetodo(
  kmPorMetodo: number | Record<MetodoDeEstimacion, number>,
  extra: Partial<Tramo>,
  cb: (estado: ReturnType<typeof evaluarFlotaEv>, metodo: MetodoDeEstimacion) => void,
) {
  for (const metodo of METODOS_DE_ESTIMACION) {
    const km = typeof kmPorMetodo === "number" ? kmPorMetodo : kmPorMetodo[metodo];
    const tramos: SenalTramoVehiculo[] = [
      { vehiculoId: "v1", quien: "Camión PPU-1234", tramo: tramo({ kmDelTramo: km, ...extra }), metodo, recordTime: RECORD_TIME },
    ];
    cb(evaluarFlotaEv({ ...hechosBase(), tramos }), metodo);
  }
}

test("SOC actual bajo el consumo estimado del tramo restante ⇒ rojo (fixture SOC 20% / consumo ~30%)", () => {
  paraCadaMetodo(200, { socActualPct: 20 }, (estado) => {
    assert.equal(estado.color, "rojo");
    assert.equal(estado.excepciones.length, 1);
    assert.equal(estado.excepciones[0]!.que, "SOC insuficiente para el tramo restante");
    assert.equal(estado.excepciones[0]!.severidad, "rojo");
  });
});

test("retorno proyectado <15% ⇒ rojo (fixture: retorno proyectado 10%)", () => {
  // actual=40, consumo=30 (90 km por wh_por_km, 76,5 km por rango_efectivo) ⇒ proyectado=10;
  // 40 ≥ 30 así que NO cae en la rama de «SOC actual bajo el consumo».
  const KM_PARA_CONSUMO_30: Record<MetodoDeEstimacion, number> = { wh_por_km: 90, rango_efectivo: 76.5 };
  paraCadaMetodo(KM_PARA_CONSUMO_30, { socActualPct: 40 }, (estado) => {
    assert.equal(estado.color, "rojo");
    assert.equal(estado.excepciones[0]!.que, "Retorno proyectado bajo el mínimo");
  });
});

test("SOC proyectado al fin del bloque < reserva+5pp ⇒ amarillo", () => {
  // actual=90, consumo=72 (216 km por wh_por_km, 183,6 km por rango_efectivo) ⇒ proyectado=18%:
  // por sobre el mínimo de retorno (15) y bajo la reserva+5pp (20, con la reserva default 15).
  const KM_PARA_CONSUMO_72: Record<MetodoDeEstimacion, number> = { wh_por_km: 216, rango_efectivo: 183.6 };
  paraCadaMetodo(KM_PARA_CONSUMO_72, { socActualPct: 90 }, (estado) => {
    assert.equal(estado.color, "amarillo");
    assert.equal(estado.excepciones[0]!.que, "SOC proyectado cerca de la reserva");
  });
});

test("tenant con reserva_pct alta en `parametros` exige más margen (§4.4) — mismo tramo, otro veredicto", () => {
  // actual=90, consumo=48 (144 km por wh_por_km) ⇒ proyectado=42%: con la reserva default (15)
  // sería verde (margen 27), pero con reserva_pct=40 el margen baja a 2 ⇒ amarillo.
  const t = tramo({ socActualPct: 90, kmDelTramo: 144, parametros: { reservaPct: 40 } });
  const estado = evaluarFlotaEv({
    ...hechosBase(),
    tramos: [{ vehiculoId: "v3", quien: "Camión PPU-9999", tramo: t, metodo: "wh_por_km", recordTime: RECORD_TIME }],
  });
  assert.equal(estado.color, "amarillo");
});

test("«no quedó enchufado» a la hora límite ⇒ rojo (hora límite fija en el fixture)", () => {
  const horaLimite = new Date("2026-08-12T22:00:00-04:00");
  const enchufados: SenalEnchufado[] = [
    {
      vehiculoId: "v4",
      quien: "Camión PPU-4321",
      turno: { enchufadoConfirmado: false, cerradoEn: new Date("2026-08-12T21:00:00-04:00") },
      horaLimite,
      ahora: new Date("2026-08-12T22:05:00-04:00"),
      recordTime: RECORD_TIME,
    },
  ];
  const estado = evaluarFlotaEv({ ...hechosBase(), enchufados });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.que, "No quedó enchufado");
});

test("`enchufadoConfirmado` NULO (nadie preguntó todavía) no dispara — no es un falso rojo", () => {
  const horaLimite = new Date("2026-08-12T22:00:00-04:00");
  const enchufados: SenalEnchufado[] = [
    {
      vehiculoId: "v5",
      quien: "Camión PPU-1111",
      turno: { enchufadoConfirmado: null, cerradoEn: new Date("2026-08-12T21:00:00-04:00") },
      horaLimite,
      ahora: new Date("2026-08-12T23:00:00-04:00"),
      recordTime: RECORD_TIME,
    },
  ];
  const estado = evaluarFlotaEv({ ...hechosBase(), enchufados });
  assert.equal(estado.color, "verde");
  assert.equal(estado.excepciones.length, 0);
});

test("sin ficha EV completa, el tramo no entra a la cola de excepciones (ni falso verde ni falso rojo)", () => {
  const t = tramo({ datos: { ...FICHA_COMPLETA, autonomiaNominalKm: null, whPorKmBase: null } });
  const estado = evaluarFlotaEv({
    ...hechosBase(),
    tramos: [{ vehiculoId: "v6", quien: "Camión PPU-2222", tramo: t, metodo: "wh_por_km", recordTime: RECORD_TIME }],
  });
  assert.equal(estado.color, "verde");
  assert.equal(estado.excepciones.length, 0);
});

test("holgado y bien enchufado ⇒ verde, agregado completo", () => {
  const t = tramo({ socActualPct: SOC.maximo, kmDelTramo: 5 });
  const estado = evaluarFlotaEv({
    ...hechosBase(),
    tramos: [{ vehiculoId: "v7", quien: "Camión PPU-3333", tramo: t, metodo: "wh_por_km", recordTime: RECORD_TIME }],
  });
  assert.equal(estado.color, "verde");
  assert.deepEqual(estado.agregado, { numerador: 5, denominador: 5 });
});

test("histéresis del margen: zona intermedia sostiene el rojo previo como amarillo, no lo apaga a verde", () => {
  // actual=90, consumo=68 (204 km por wh_por_km) ⇒ proyectado=22, margen=22-15=7 — entre
  // recuperación (10) y amarillo (5): con colorPrevio rojo, la zona intermedia baja UN escalón
  // a amarillo, no salta directo a verde (§2.4, misma mecánica que AC-FSEM-02).
  const t = tramo({ socActualPct: 90, kmDelTramo: 204 });
  const estado = evaluarFlotaEv({
    ...hechosBase(),
    colorPrevioMargen: "rojo",
    tramos: [{ vehiculoId: "v8", quien: "Camión PPU-8888", tramo: t, metodo: "wh_por_km", recordTime: RECORD_TIME }],
  });
  assert.equal(estado.color, "amarillo");
});

test("el color de la tarjeta es el PEOR entre tramos y enchufado", () => {
  const rojo = tramo({ socActualPct: 20, kmDelTramo: 200 });
  const horaLimite = new Date("2026-08-12T22:00:00-04:00");
  const estado = evaluarFlotaEv({
    ...hechosBase(),
    tramos: [{ vehiculoId: "v9", quien: "Camión PPU-7777", tramo: rojo, metodo: "wh_por_km", recordTime: RECORD_TIME }],
    enchufados: [
      {
        vehiculoId: "v10",
        quien: "Camión PPU-6666",
        turno: { enchufadoConfirmado: false, cerradoEn: new Date("2026-08-12T21:00:00-04:00") },
        horaLimite,
        ahora: new Date("2026-08-12T22:05:00-04:00"),
        recordTime: RECORD_TIME,
      },
    ],
  });
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 2);
});
