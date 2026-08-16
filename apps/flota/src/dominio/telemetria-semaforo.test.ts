import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLUJO_DIGEST_SEMAFORO,
  colaAlCierreDelDia,
  metricaDeDigest,
  type CierreDeJornada,
} from "./telemetria-semaforo.ts";
import { seedCierresDeJornada } from "./panel-saas-fixtures.ts";

// Telemetría del módulo semáforo hacia el §10 [AC-FSEM-14] — spec 05 §5, maestro §10, §4.6.

const UUID = "0198c0de-1111-7000-8000-000000000001";
const TS = new Date("2026-08-16T09:15:00.000Z");

test("[AC-FSEM-14] el digest emite una fila de client_metric del catálogo CERRADO del §4.6", () => {
  const m = metricaDeDigest(842, UUID, TS, -240);
  assert.notEqual(m, null);
  assert.equal(m!.tipo, "latencia_ms");
  assert.equal(m!.flujo, FLUJO_DIGEST_SEMAFORO);
  assert.equal(m!.valor_int, 842);
  assert.equal(m!.client_uuid, UUID);
  assert.equal(m!.ts, TS.toISOString());
  assert.equal(m!.tz_offset_min, -240);
});

test("[AC-FSEM-14] el tipo emitido pertenece al enum CERRADO `metrica_cliente` — el módulo NO amplía el catálogo", () => {
  // Se lee la migración y no una copia en TS: el enum vive en la BD (0002) y ES la autoridad. Si
  // el digest viajara con un tipo inventado, `metricaBienFormada` lo filtraría y la telemetría del
  // piloto se perdería en silencio, con 2xx y todo (§4.2: la captura jamás rebota).
  const ddl = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "db", "migraciones-flota", "tenant", "0002_hechos_evidencia_y_revision.sql"),
    "utf8",
  );
  const enumado = /create type metrica_cliente as enum \(([^)]*)\)/.exec(ddl);
  assert.notEqual(enumado, null);
  const tipos = enumado![1]!.split(",").map((t) => t.trim().replace(/'/g, ""));
  assert.ok(tipos.includes(metricaDeDigest(1, UUID, TS, 0)!.tipo));
  assert.equal(tipos.includes("digest_semaforo"), false);
});

test("[AC-FSEM-14] la latencia se redondea a milisegundos enteros: `valor_int` es bigint en la BD", () => {
  assert.equal(metricaDeDigest(842.4, UUID, TS, 0)!.valor_int, 842);
  assert.equal(metricaDeDigest(842.6, UUID, TS, 0)!.valor_int, 843);
});

test("[AC-FSEM-14] un digest instantáneo (0 ms) SÍ se mide: cero es una medición, no una falta de medición", () => {
  const m = metricaDeDigest(0, UUID, TS, 0);
  assert.notEqual(m, null);
  assert.equal(m!.valor_int, 0);
});

test("[AC-FSEM-14] latencia negativa o no finita NO emite fila: el reloj se movió, no hubo medición", () => {
  assert.equal(metricaDeDigest(-1, UUID, TS, 0), null);
  assert.equal(metricaDeDigest(Number.NaN, UUID, TS, 0), null);
  assert.equal(metricaDeDigest(Number.POSITIVE_INFINITY, UUID, TS, 0), null);
});

// ─── Cola al cierre del día ───────────────────────────────────────────────────────────

const SEMANA: CierreDeJornada[] = [
  { fecha: "2026-08-10", pendientes: 9 },
  { fecha: "2026-08-11", pendientes: 6 },
  { fecha: "2026-08-12", pendientes: 7 },
  { fecha: "2026-08-13", pendientes: 3 },
  { fecha: "2026-08-14", pendientes: 0 },
];

test("[AC-FSEM-14] la cola que llega a cero tiende a cero, y el panel muestra la ventana entera", () => {
  const cola = colaAlCierreDelDia(SEMANA);
  assert.equal(cola.pendientesUltimoCierre, 0);
  assert.deepEqual(cola.tendencia, [9, 6, 7, 3, 0]);
  assert.equal(cola.tiendeACero, true);
  assert.equal(cola.creciente, false);
});

test("[AC-FSEM-14] bajar sin llegar a cero también es tender a cero (§10: la conducta, no el número exacto)", () => {
  const cola = colaAlCierreDelDia([
    { fecha: "2026-08-10", pendientes: 12 },
    { fecha: "2026-08-11", pendientes: 5 },
  ]);
  assert.equal(cola.tiendeACero, true);
  assert.equal(cola.creciente, false);
});

test("[AC-FSEM-14] la cola que crece de punta a punta enciende la bandera y NO tiende a cero", () => {
  const cola = colaAlCierreDelDia([
    { fecha: "2026-08-10", pendientes: 2 },
    { fecha: "2026-08-11", pendientes: 2 },
    { fecha: "2026-08-12", pendientes: 5 },
  ]);
  assert.equal(cola.tiendeACero, false);
  assert.equal(cola.creciente, true);
});

test("[AC-FSEM-14] la que sube y se aplana sigue sin tender a cero: se compara con el extremo viejo, no con el par final", () => {
  const cola = colaAlCierreDelDia([
    { fecha: "2026-08-10", pendientes: 1 },
    { fecha: "2026-08-11", pendientes: 4 },
    { fecha: "2026-08-12", pendientes: 4 },
  ]);
  assert.equal(cola.creciente, true);
  assert.equal(cola.tiendeACero, false);
});

test("[AC-FSEM-14] una sola jornada no es una tendencia, aunque haya cerrado en cero", () => {
  const cola = colaAlCierreDelDia([{ fecha: "2026-08-14", pendientes: 0 }]);
  assert.equal(cola.pendientesUltimoCierre, 0);
  assert.equal(cola.tiendeACero, false);
  assert.equal(cola.creciente, false);
});

test("[AC-FSEM-14] ventana vacía: el panel declara NULL, jamás un cero inventado", () => {
  const cola = colaAlCierreDelDia([]);
  assert.equal(cola.pendientesUltimoCierre, null);
  assert.deepEqual(cola.tendencia, []);
  assert.equal(cola.tiendeACero, false);
});

test("[AC-FSEM-14] el orden lo pone la función: un payload desordenado rinde la misma tendencia", () => {
  const desordenada = [SEMANA[4]!, SEMANA[1]!, SEMANA[3]!, SEMANA[0]!, SEMANA[2]!];
  assert.deepEqual(colaAlCierreDelDia(desordenada).tendencia, [9, 6, 7, 3, 0]);
});

test("[AC-FSEM-14] payload imposible: conteo negativo o fraccionario rebota, el panel no lo dibuja", () => {
  assert.throws(() => colaAlCierreDelDia([{ fecha: "2026-08-10", pendientes: -1 }]), /entero/);
  assert.throws(() => colaAlCierreDelDia([{ fecha: "2026-08-10", pendientes: 1.5 }]), /entero/);
});

test("[AC-FSEM-14] fixture del panel §10: la semana del piloto converge y la sección pinta «Tiende a cero»", () => {
  // El payload de referencia que la vista recibe por su prop `colaAlCierre`
  // (`plano-eauto/panel-saas-vista.tsx`, sección `panel-saas-cola-cierre`), ejercido por la
  // MISMA función que el panel usa. Sin esta prueba el fixture y la sección se creen entre
  // ellos: la prop existía sin un solo payload de referencia detrás.
  const cola = colaAlCierreDelDia(seedCierresDeJornada());
  assert.equal(cola.pendientesUltimoCierre, 0);
  assert.deepEqual(cola.tendencia, [14, 11, 12, 7, 4, 2, 0]);
  assert.equal(cola.tiendeACero, true);
  // La bandera roja del §10 apagada es parte de la aserción, no un descuido: el fixture de
  // exenciones (AC-FSEM-22) ejercita el caso creciente y este el sano, y la sección se pinta
  // distinto en cada uno.
  assert.equal(cola.creciente, false);
  // El rebote del tercer día sigue DENTRO de la tendencia que el panel dibuja: el §10 pide ver
  // el camino, no una recta — un agregado que escondiera el 12 estaría maquillando el piloto.
  assert.ok(cola.tendencia[2]! > cola.tendencia[1]!);
});

test("[AC-FSEM-14] fixture del panel §10: el fin de semana sin cierre no inventa jornadas ni descoloca la ventana", () => {
  // 7 cierres para 9 días corridos (8 y 9 de agosto son sábado y domingo). Una ventana que
  // rellenara el hueco con ceros diría «cerró el día sin cola» dos veces, que es justo la
  // afirmación falsa que el NULL declarado del resto del panel viene a evitar.
  const cierres = seedCierresDeJornada();
  assert.equal(cierres.length, 7);
  assert.equal(cierres.some((c) => c.fecha === "2026-08-08" || c.fecha === "2026-08-09"), false);
  assert.deepEqual(
    colaAlCierreDelDia([...cierres].reverse()).tendencia,
    colaAlCierreDelDia(cierres).tendencia,
  );
});

test("[AC-FSEM-14] la misma jornada dos veces rebota: sería contar un cierre dos veces en la tendencia", () => {
  assert.throws(
    () =>
      colaAlCierreDelDia([
        { fecha: "2026-08-10", pendientes: 3 },
        { fecha: "2026-08-10", pendientes: 4 },
      ]),
    /dos veces/,
  );
});
