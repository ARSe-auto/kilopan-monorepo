import test from "node:test";
import assert from "node:assert/strict";
import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  ENTREGA_FELIZ_ACCIONES,
  iniciarRecorrido,
  paradaActual,
  llegar,
  entregar,
  deshacer,
  cerrarLaVentana,
  terminado,
  type Recorrido,
  type ParadaDeRuta,
} from "./pod-terreno.ts";

// Mutantes del bucle de terreno de F4 [AC-FPOD-01] — §5.2 F4, §5.3, §4.7, §0.
//
// El presupuesto de toques es un CONTRATO (§5.3) y acá se mide sobre la máquina: cada
// transición que el chofer provoca con un dedo pasa por el contador, y el camino feliz tiene
// que costar exactamente `ENTREGA_FELIZ_ACCIONES`. El e2e mide lo mismo sobre la pantalla real
// (`e2e/pod-feliz.spec.ts`); acá se protege el bucle aunque la pantalla cambie de forma.

const PARADAS: ParadaDeRuta[] = [
  { id: "p1", orden: 1, destino: "Sucursal Independencia", ventana: "08:00 a 10:00", bultos: 12 },
  { id: "p2", orden: 2, destino: "Sucursal Recoleta", ventana: null, bultos: 4 },
  { id: "p3", orden: 3, destino: "Sucursal Conchalí", ventana: null, bultos: 7 },
];

const SELLO = {
  clientUuid: "019853b7-0000-7000-8000-00000000aaaa",
  tsDispositivo: "2026-08-11T13:20:00.000Z",
  tzOffsetMin: -240,
};

/** Cuenta ACCIONES con la convención cerrada del §5.3, igual que el e2e. */
function contador(r: Recorrido) {
  let acciones = 0;
  let estado = r;
  return {
    get acciones() {
      return acciones;
    },
    get estado() {
      return estado;
    },
    tocar(transicion: (r: Recorrido) => Recorrido) {
      acciones++;
      estado = transicion(estado);
    },
  };
}

test("[AC-FPOD-01] la entrega feliz cuesta DOS acciones exactas y deja al chofer en la siguiente", () => {
  const c = contador(iniciarRecorrido(PARADAS));

  c.tocar(llegar);
  c.tocar((r) => entregar(r, SELLO));

  assert.equal(c.acciones, ENTREGA_FELIZ_ACCIONES);
  assert.equal(c.acciones, 2, "el §5.2 F4 fija dos toques exactos por entrega");
  // El avance es parte de la segunda acción, no un toque más: la tarjeta que quedó a la vista
  // ya es la de la parada siguiente.
  assert.equal(paradaActual(c.estado)?.id, "p2");
  assert.equal(c.estado.llegada, false, "la parada nueva arranca sin «Llegué» dado");
});

test("[AC-FPOD-01] la captura nace en pending_undo y NO sale del dispositivo hasta que vence la ventana", () => {
  const entregada = entregar(llegar(iniciarRecorrido(PARADAS)), SELLO);

  assert.equal(entregada.captura?.estado, UNDO.estado_local);
  assert.equal(entregada.captura?.paradaId, "p1");
  assert.equal(entregada.captura?.resultado, "exito");
  // El doble reloj del §4.6 y el `client_uuid` del §0 viajan con ella desde el primer momento.
  assert.equal(entregada.captura?.clientUuid, SELLO.clientUuid);
  assert.equal(entregada.captura?.tsDispositivo, SELLO.tsDispositivo);
  assert.equal(entregada.captura?.tzOffsetMin, SELLO.tzOffsetMin);
  assert.deepEqual(entregada.cola, [], "dentro de la ventana no hay nada que replayar");
});

test("[AC-FPOD-01] vencida la ventana, la captura pasa a la cola del motor de sync", () => {
  const cerrada = cerrarLaVentana(entregar(llegar(iniciarRecorrido(PARADAS)), SELLO));

  assert.equal(cerrada.captura, null);
  assert.equal(cerrada.cola.length, 1);
  assert.equal(cerrada.cola[0]?.estado, "por_replicar");
  assert.equal(cerrada.cola[0]?.clientUuid, SELLO.clientUuid);
  // Cerrar una ventana que ya venció no duplica la captura: el temporizador puede dispararse
  // dos veces si la pantalla se re-monta, y una entrega contada dos veces es carga inventada.
  assert.deepEqual(cerrarLaVentana(cerrada), cerrada);
});

test("[AC-FPOD-01] deshacer dentro de la ventana cancela la captura y devuelve a la parada", () => {
  const deshecha = deshacer(entregar(llegar(iniciarRecorrido(PARADAS)), SELLO));

  assert.equal(paradaActual(deshecha)?.id, "p1", "vuelve a la parada que deshizo");
  assert.equal(deshecha.llegada, true, "y con «Llegué» ya dado: es donde estaba parado");
  assert.equal(deshecha.captura, null);
  assert.deepEqual(deshecha.cola, [], "la mutación se canceló ANTES del replay (§4.7)");
});

test("[AC-FPOD-01] deshacer fuera de la ventana no toca nada: eso ya es supersede, no undo", () => {
  const cerrada = cerrarLaVentana(entregar(llegar(iniciarRecorrido(PARADAS)), SELLO));

  // Post-replay el undo es un supersede con motivo `undo` (§4.7) y es AC-FPOD-08: acá lo que
  // importa es que esta máquina NO borre una captura que ya es un hecho.
  assert.deepEqual(deshacer(cerrada), cerrada);
});

test("[AC-FPOD-01] «Entregado» sin haber llegado no cierra la parada", () => {
  const sinLlegar = entregar(iniciarRecorrido(PARADAS), SELLO);

  assert.deepEqual(sinLlegar, iniciarRecorrido(PARADAS));
  assert.equal(paradaActual(sinLlegar)?.id, "p1");
});

test("[AC-FPOD-01] dos entregas seguidas dentro de los 8 s no pierden la primera", () => {
  const primera = entregar(llegar(iniciarRecorrido(PARADAS)), SELLO);
  const segunda = entregar(llegar(primera), { ...SELLO, clientUuid: "019853b7-0000-7000-8000-00000000bbbb" });

  assert.equal(segunda.cola.length, 1, "la primera se cerró sola al llegar la segunda");
  assert.equal(segunda.cola[0]?.clientUuid, SELLO.clientUuid);
  assert.equal(segunda.captura?.paradaId, "p2");
  assert.equal(paradaActual(segunda)?.id, "p3");
});

test("[AC-FPOD-01] entregada la última parada, la ruta queda terminada y no avanza más", () => {
  let r = iniciarRecorrido(PARADAS);
  PARADAS.forEach((parada, n) => {
    assert.equal(paradaActual(r)?.id, parada.id);
    r = entregar(llegar(r), { ...SELLO, clientUuid: `019853b7-0000-7000-8000-00000000ddd${n}` });
  });

  assert.equal(terminado(r), true);
  assert.equal(paradaActual(r), null);
  // Sobre una ruta terminada los dos toques no hacen nada: no hay parada que cerrar.
  assert.deepEqual(llegar(r), r);
  assert.deepEqual(entregar(r, SELLO), r);
});

test("[AC-FPOD-01] «Llegué» dos veces es una sola llegada", () => {
  const unaVez = llegar(iniciarRecorrido(PARADAS));

  assert.deepEqual(llegar(unaVez), unaVez);
});
