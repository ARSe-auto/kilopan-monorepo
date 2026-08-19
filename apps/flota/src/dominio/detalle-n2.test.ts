import { test } from "node:test";
import assert from "node:assert/strict";
import { construirDetalleN2, TIPOS_EVIDENCIA_N2 } from "./detalle-n2.ts";
import type { FilaPeek } from "./peek-n1.ts";

// Detalle N2 [AC-FSEM-05] — spec 05 §2.3: «timeline de eventos + evidencia completa … cada
// tipo de evidencia es mejora progresiva: si falta, la sección degrada sin hueco ni error».

const FILA: FilaPeek = {
  id: "exc-1",
  dominio: "datos_sync",
  severidad: "rojo",
  quien: "Furgón CCJJ88",
  que: "Sin sync con turno abierto",
  cuanto: "5 h sin sincronizar",
  desde: new Date("2026-08-12T09:00:00-04:00"),
  playbook: "Contactar al conductor y verificar la conectividad del aparato.",
  estado: "nueva",
};

test("[AC-FSEM-05] sin ninguna evidencia: los 4 tipos igual aparecen, todos ausentes — sin hueco", () => {
  const detalle = construirDetalleN2(FILA, [], {});
  assert.equal(detalle.evidencia.length, TIPOS_EVIDENCIA_N2.length);
  assert.deepEqual(
    detalle.evidencia.map((e) => e.tipo),
    [...TIPOS_EVIDENCIA_N2],
  );
  for (const e of detalle.evidencia) assert.equal(e.presente, false);
});

test("[AC-FSEM-05] evidencia parcial: la presente trae su detalle, la ausente queda marcada — mismo orden fijo", () => {
  const detalle = construirDetalleN2(FILA, [], { sync: "Reintento automático fallido — 3 intentos" });
  assert.deepEqual(
    detalle.evidencia.map((e) => e.tipo),
    [...TIPOS_EVIDENCIA_N2],
  );
  const foto = detalle.evidencia.find((e) => e.tipo === "foto")!;
  const gps = detalle.evidencia.find((e) => e.tipo === "gps")!;
  const soc = detalle.evidencia.find((e) => e.tipo === "soc")!;
  const sync = detalle.evidencia.find((e) => e.tipo === "sync")!;
  assert.equal(foto.presente, false);
  assert.equal(gps.presente, false);
  assert.equal(soc.presente, false);
  assert.equal(sync.presente, true);
  assert.equal(sync.presente && sync.detalle, "Reintento automático fallido — 3 intentos");
});

test("[AC-FSEM-05] evidencia completa: los 4 tipos presentes con su detalle propio", () => {
  const detalle = construirDetalleN2(FILA, [], {
    foto: "foto.jpg",
    gps: "-33.45,-70.66",
    soc: "82% → 20% en 4 tramos",
    sync: "sin incidentes",
  });
  for (const e of detalle.evidencia) {
    assert.equal(e.presente, true);
    assert.ok(e.presente && e.detalle.length > 0);
  }
});

test("[AC-FSEM-05] el timeline y los campos de la fila viajan sin cambios al detalle", () => {
  const timeline = [
    { id: "t1", texto: "Secuencia 4120 registrada", cuando: new Date("2026-08-12T04:48:00-04:00") },
    { id: "t2", texto: "Hueco detectado: falta la secuencia 4121", cuando: new Date("2026-08-12T05:00:00-04:00") },
  ];
  const detalle = construirDetalleN2(FILA, timeline, {});
  assert.deepEqual(detalle.timeline, timeline);
  assert.equal(detalle.id, FILA.id);
  assert.equal(detalle.quien, FILA.quien);
  assert.equal(detalle.playbook, FILA.playbook);
  assert.equal(detalle.severidad, FILA.severidad);
  assert.equal(detalle.estado, FILA.estado);
});
