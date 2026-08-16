import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluarEntregasVsPlan,
  type HechosEntregasVsPlan,
  type SenalNoEntregasRuta,
} from "./semaforo-entregas-vs-plan.ts";

// Dominio Entregas vs plan [AC-FSEM-19] — spec 05 §2.5, Anexo B, fila `entregas_vs_plan`
// (migración 0059: amarillo 5%, rojo 10%, recuperación 3%).

const RECORD_TIME = new Date("2026-08-12T14:00:00-04:00");
const UMBRALES = { umbral_amarillo: 5, umbral_rojo: 10, umbral_recuperacion: 3 };

function ruta(overrides: Partial<SenalNoEntregasRuta> = {}): SenalNoEntregasRuta {
  return {
    rutaId: "ruta-madrugada-12-ago",
    quien: "Ruta madrugada 12-ago",
    noEntregasPct: 5,
    recordTime: RECORD_TIME,
    ...overrides,
  };
}

function hechosBase(overrides: Partial<HechosEntregasVsPlan> = {}): HechosEntregasVsPlan {
  return {
    umbrales: UMBRALES,
    colorPrevioPorRuta: {},
    rutas: [],
    comprometidoVencidoSinEntrega: [],
    totalRutas: 5,
    ...overrides,
  };
}

test("10% exacto de no-entregas ⇒ amarillo (cae en la banda seed 5–10%, no supera el rojo >10%)", () => {
  const estado = evaluarEntregasVsPlan(hechosBase({ rutas: [ruta({ noEntregasPct: 10 })] }));
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.que, "No-entregas sobre el plan");
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("12% de no-entregas ⇒ rojo", () => {
  const estado = evaluarEntregasVsPlan(hechosBase({ rutas: [ruta({ noEntregasPct: 12 })] }));
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
  assert.equal(estado.excepciones[0]!.cuanto, "12% no-entregas");
});

test("bajo el 5% ⇒ verde, sin excepción", () => {
  const estado = evaluarEntregasVsPlan(hechosBase({ rutas: [ruta({ noEntregasPct: 4 })] }));
  assert.equal(estado.color, "verde");
  assert.equal(estado.excepciones.length, 0);
});

test("compromiso vencido sin entrega ⇒ rojo, computado de promesa_original congelada — no depende del ETA vivo", () => {
  const estado = evaluarEntregasVsPlan(
    hechosBase({
      comprometidoVencidoSinEntrega: [
        {
          paradaId: "parada-9",
          quien: "Farmacia del Centro",
          cuanto: "ventana vencida hace 45 min",
          recordTime: RECORD_TIME,
        },
      ],
    }),
  );
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.que, "Compromiso vencido sin entrega");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
});

test("el color de la tarjeta es el PEOR entre no-entregas y compromiso vencido", () => {
  const estado = evaluarEntregasVsPlan(
    hechosBase({
      rutas: [ruta({ noEntregasPct: 6 })],
      comprometidoVencidoSinEntrega: [
        { paradaId: "parada-2", quien: "Minimarket Sur", cuanto: "vencida", recordTime: RECORD_TIME },
      ],
    }),
  );
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 2);
});

test("histéresis: rojo previo que retrocede a zona intermedia se queda amarillo, no salta a verde", () => {
  const estado = evaluarEntregasVsPlan(
    hechosBase({
      colorPrevioPorRuta: { "ruta-madrugada-12-ago": "rojo" },
      rutas: [ruta({ noEntregasPct: 4 })], // entre recuperación (3) y amarillo (5)
    }),
  );
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("nada pendiente ⇒ verde, agregado completo", () => {
  const estado = evaluarEntregasVsPlan(hechosBase());
  assert.equal(estado.color, "verde");
  assert.deepEqual(estado.agregado, { numerador: 5, denominador: 5 });
  assert.equal(estado.excepciones.length, 0);
});

test("«ETA proyectada + tolerancia excede ventana» (amarillo, Anexo B) NO se implementa — CONDICIONADA a la pregunta 4: el tipo de hechos no trae ningún campo de ETA", () => {
  const hechos = hechosBase();
  assert.deepEqual(Object.keys(hechos).sort(), [
    "colorPrevioPorRuta",
    "comprometidoVencidoSinEntrega",
    "rutas",
    "totalRutas",
    "umbrales",
  ]);
});
