import test from "node:test";
import assert from "node:assert/strict";
import { proyectarEstadoDeParada, type EventoDeParada } from "./proyeccion-parada.ts";

// Mutantes de la proyección del estado visible [AC-FPOD-21] — §4.6, §2.
//
// El caso que hace real el AC es el tercero: dos eventos con `event_time` INVERTIDO respecto de
// su `secuencia` de llegada. Si la proyección mirara `event_time` en vez de `secuencia`, elegiría
// el evento equivocado, y el terreno vería una entrega «exitosa» que en realidad falló después
// (o viceversa) — silenciosamente, porque las dos capturas aterrizan 2xx (§4.2).

test("sin eventos: pending, lo que la 0037 da por DEFAULT y nadie proyectó todavía", () => {
  assert.deepEqual(proyectarEstadoDeParada([]), {
    estado: "pending",
    resultado: null,
    metodoEntrega: null,
    motivoId: null,
  });
});

test("un solo evento decide el estado", () => {
  const eventos: EventoDeParada[] = [
    { secuencia: 1, payload: { resultado: "exito", metodo_entrega: "entregado_en_mano", motivo_id: null } },
  ];
  assert.deepEqual(proyectarEstadoDeParada(eventos), {
    estado: "done",
    resultado: "exito",
    metodoEntrega: "entregado_en_mano",
    motivoId: null,
  });
});

test("[AC-FPOD-21] event_time invertido no importa: manda la SECUENCIA, el orden de llegada al servidor", () => {
  // La secuencia 5 es la que aterrizó PRIMERO (event_time 12:00, el más tardío de los dos); la
  // secuencia 6 aterrizó SEGUNDO pero con un event_time MÁS TEMPRANO (09:00) — el escenario de
  // drift/offline del §4.6. El orden autoritativo es el de llegada al servidor: gana la 6.
  const eventos: EventoDeParada[] = [
    { secuencia: 5, payload: { resultado: "exito" } },
    { secuencia: 6, payload: { resultado: "fallo" } },
  ];
  assert.equal(
    proyectarEstadoDeParada(eventos).resultado,
    "fallo",
    "el orden autoritativo es la secuencia del servidor, no el event_time del dispositivo",
  );
});

test("el orden en que los eventos llegan al array no importa, solo su secuencia", () => {
  const eventos: EventoDeParada[] = [
    { secuencia: 9, payload: { resultado: "parcial" } },
    { secuencia: 3, payload: { resultado: "exito" } },
  ];
  assert.equal(proyectarEstadoDeParada(eventos).resultado, "parcial");
});

test("un resultado que no está en el catálogo del §4.5 no cierra la parada", () => {
  const eventos: EventoDeParada[] = [{ secuencia: 1, payload: { resultado: "algo_que_no_es_del_catalogo" } }];
  assert.deepEqual(proyectarEstadoDeParada(eventos), {
    estado: "pending",
    resultado: null,
    metodoEntrega: null,
    motivoId: null,
  });
});

test("metodo_entrega y motivo_id no textuales se leen como ausentes, no rompen la proyección", () => {
  const eventos: EventoDeParada[] = [
    { secuencia: 1, payload: { resultado: "fallo", metodo_entrega: 123, motivo_id: undefined } },
  ];
  const visible = proyectarEstadoDeParada(eventos);
  assert.equal(visible.metodoEntrega, null);
  assert.equal(visible.motivoId, null);
});

test("tres capturas: gana la de mayor secuencia aunque no sea la última del array ni la de event_time más tardío", () => {
  const eventos: EventoDeParada[] = [
    { secuencia: 20, payload: { resultado: "fallo" } },
    { secuencia: 18, payload: { resultado: "exito" } },
    { secuencia: 19, payload: { resultado: "parcial" } },
  ];
  assert.equal(proyectarEstadoDeParada(eventos).resultado, "fallo");
});
