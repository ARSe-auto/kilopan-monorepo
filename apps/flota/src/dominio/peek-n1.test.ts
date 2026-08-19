import test from "node:test";
import assert from "node:assert/strict";
import { ordenarPeek, filasPeekDeDominio, type FilaPeek } from "./peek-n1.ts";
import { seedA, seedC } from "./semaforo-fixtures.ts";

// Peek N1 [AC-FSEM-04] — §2.2 de la spec 05: orden severidad × antigüedad, y una excepción
// sin los campos del peek (quién/qué/cuánto/playbook/severidad) no entra a la lista.

const HOY = new Date("2026-08-12T14:00:00-04:00");
const horasAntes = (h: number) => new Date(HOY.getTime() - h * 60 * 60 * 1000);

function fila(parcial: Partial<FilaPeek> & Pick<FilaPeek, "id" | "severidad" | "desde">): FilaPeek {
  return {
    dominio: "d",
    quien: "x",
    que: "x",
    cuanto: "x",
    playbook: "x",
    estado: "nueva",
    ...parcial,
  };
}

test("[AC-FSEM-04] la severidad manda sobre la antigüedad: un rojo reciente va ANTES que un amarillo viejo", () => {
  const filas = [
    fila({ id: "amarillo-viejo", severidad: "amarillo", desde: horasAntes(9) }),
    fila({ id: "rojo-reciente", severidad: "rojo", desde: horasAntes(1) }),
  ];
  const orden = ordenarPeek(filas).map((f) => f.id);
  assert.deepEqual(orden, ["rojo-reciente", "amarillo-viejo"]);
});

test("[AC-FSEM-04] dentro de la misma severidad, la más antigua por record_time va primero", () => {
  const filas = [
    fila({ id: "rojo-reciente", severidad: "rojo", desde: horasAntes(1) }),
    fila({ id: "rojo-media", severidad: "rojo", desde: horasAntes(5) }),
    fila({ id: "rojo-vieja", severidad: "rojo", desde: horasAntes(9) }),
  ];
  const orden = ordenarPeek(filas).map((f) => f.id);
  assert.deepEqual(orden, ["rojo-vieja", "rojo-media", "rojo-reciente"]);
});

test("[AC-FSEM-04] no muta el arreglo de entrada", () => {
  const filas = [fila({ id: "a", severidad: "amarillo", desde: horasAntes(1) }), fila({ id: "b", severidad: "rojo", desde: horasAntes(2) })];
  const copia = [...filas];
  ordenarPeek(filas);
  assert.deepEqual(filas, copia);
});

test("[AC-FSEM-04] filasPeekDeDominio: seed A, datos/sync trae sus 3 filas ordenadas por antigüedad (todas rojo)", () => {
  const datosSync = seedA().find((e) => e.clave === "datos_sync")!;
  const filas = filasPeekDeDominio(datosSync);
  assert.deepEqual(
    filas.map((f) => f.id),
    ["exc-sync-1", "exc-sync-2", "exc-sync-3"],
    "9h, 5h, 3h — la más vieja primero",
  );
  for (const f of filas) {
    assert.equal(f.dominio, "datos_sync");
    assert.equal(f.severidad, "rojo");
    assert.equal(f.estado, "nueva");
    assert.ok(f.quien.length > 0 && f.que.length > 0 && f.cuanto.length > 0 && f.playbook.length > 0);
  }
});

test("[AC-FSEM-04] filasPeekDeDominio: seed A, turnos/conductores trae sus 2 filas amarillas", () => {
  const turnos = seedA().find((e) => e.clave === "turnos_conductores")!;
  const filas = filasPeekDeDominio(turnos);
  assert.equal(filas.length, 2);
  assert.ok(filas.every((f) => f.severidad === "amarillo"));
});

test("[AC-FSEM-04] filasPeekDeDominio: un dominio verde (sin excepciones) rinde lista vacía", () => {
  const verde = seedA().find((e) => e.clave === "entregas_vs_plan")!;
  assert.deepEqual(filasPeekDeDominio(verde), []);
});

test("[AC-FSEM-04] filasPeekDeDominio: una excepción cruda sin campos de peek se descarta, no rinde un hueco", () => {
  const conExcepcionIncompleta = {
    clave: "entregas_vs_plan" as const,
    color: "rojo" as const,
    agregado: { numerador: 1, denominador: 2 },
    excepciones: [{ id: "sin-campos", descripcion: "vieja forma, sin quien/que/cuanto/playbook", record_time: horasAntes(1) }],
  };
  assert.deepEqual(filasPeekDeDominio(conExcepcionIncompleta), []);
});

test("[AC-FSEM-04] seed C: flota/energía EV y caja/custodia también rinden sus filas completas", () => {
  const ev = seedC().find((e) => e.clave === "flota_energia_ev")!;
  const caja = seedC().find((e) => e.clave === "caja_custodia_liquidacion")!;
  assert.equal(filasPeekDeDominio(ev).length, 1);
  assert.equal(filasPeekDeDominio(caja).length, 1);
  assert.equal(filasPeekDeDominio(ev)[0]!.severidad, "rojo");
  assert.equal(filasPeekDeDominio(caja)[0]!.severidad, "amarillo");
});
