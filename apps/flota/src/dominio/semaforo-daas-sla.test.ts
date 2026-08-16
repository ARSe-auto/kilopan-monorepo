import test from "node:test";
import assert from "node:assert/strict";
import { evaluarDaasSla, type HechosDaasSla, type SenalOtdEmpresa } from "./semaforo-daas-sla.ts";

// Dominio DaaS/SLA [AC-FSEM-18] — spec 05 §2.5, Anexo B, fila `daas_sla` (migración 0059:
// amarillo 2 pp, rojo 5 pp, recuperación 0 pp).

const RECORD_TIME = new Date("2026-08-12T14:00:00-04:00");
const UMBRALES = { umbral_amarillo: 2, umbral_rojo: 5, umbral_recuperacion: 0 };

function farmacia(overrides: Partial<SenalOtdEmpresa> = {}): SenalOtdEmpresa {
  return {
    empresaId: "farmacia-del-centro",
    empresaNombre: "Farmacia del Centro",
    otdComprometidoPct: 95,
    otdProyectadoPct: 95,
    otdPeriodoCerradoPct: null,
    recordTime: RECORD_TIME,
    ...overrides,
  };
}

function hechosBase(empresas: SenalOtdEmpresa[]): HechosDaasSla {
  return { umbrales: UMBRALES, colorPrevioPorEmpresa: {}, empresas };
}

test("OTD proyectado 2 pp bajo el comprometido (período abierto) ⇒ amarillo", () => {
  const estado = evaluarDaasSla(hechosBase([farmacia({ otdProyectadoPct: 93 })]));
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.que, "OTD proyectado bajo el comprometido");
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});

test("SLA incumplido en el período — fixture del AC: comprometido 95, período cerrado 90 ⇒ rojo", () => {
  const estado = evaluarDaasSla(
    hechosBase([farmacia({ otdProyectadoPct: 93, otdPeriodoCerradoPct: 90 })]),
  );
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 1);
  assert.equal(estado.excepciones[0]!.que, "SLA incumplido en el período");
  assert.equal(estado.excepciones[0]!.severidad, "rojo");
  assert.match(estado.excepciones[0]!.cuanto!, /déficit 5\.0 pp/);
});

test("empresa con otd_comprometido_pct NULL ⇒ no evalúa: sin excepción y fuera del denominador", () => {
  const estado = evaluarDaasSla(
    hechosBase([
      farmacia({ otdComprometidoPct: null, otdProyectadoPct: 40 }),
      farmacia({ empresaId: "distribuidora-andes", empresaNombre: "Distribuidora Andes" }),
    ]),
  );
  assert.equal(estado.color, "verde");
  assert.equal(estado.excepciones.length, 0);
  assert.deepEqual(estado.agregado, { numerador: 1, denominador: 1 });
});

test("OTD en o sobre el comprometido ⇒ verde, agregado completo", () => {
  const estado = evaluarDaasSla(hechosBase([farmacia(), farmacia({ empresaId: "e2", otdProyectadoPct: 97 })]));
  assert.equal(estado.color, "verde");
  assert.deepEqual(estado.agregado, { numerador: 2, denominador: 2 });
  assert.equal(estado.excepciones.length, 0);
});

test("el color de la tarjeta es el PEOR entre varias empresas", () => {
  const estado = evaluarDaasSla(
    hechosBase([
      farmacia({ otdProyectadoPct: 93 }),
      farmacia({ empresaId: "distribuidora-andes", empresaNombre: "Distribuidora Andes", otdPeriodoCerradoPct: 88 }),
    ]),
  );
  assert.equal(estado.color, "rojo");
  assert.equal(estado.excepciones.length, 2);
});

test("histéresis: rojo previo que retrocede a zona intermedia se queda amarillo, no salta a verde", () => {
  const estado = evaluarDaasSla({
    umbrales: UMBRALES,
    colorPrevioPorEmpresa: { "farmacia-del-centro": "rojo" },
    empresas: [farmacia({ otdPeriodoCerradoPct: 94 })], // déficit 1 pp: entre recuperación (0) y amarillo (2)
  });
  assert.equal(estado.color, "amarillo");
  assert.equal(estado.excepciones[0]!.severidad, "amarillo");
});
