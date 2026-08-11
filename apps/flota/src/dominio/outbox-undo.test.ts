import { test } from "node:test";
import assert from "node:assert/strict";
import { colaAlArrancar, deshacerCaptura, outboxDeRecorrido } from "./outbox-undo.ts";
import { leerOutbox, guardarOutbox, type AlmacenLocal } from "../cliente/outbox-local.ts";
import {
  iniciarRecorrido,
  llegar,
  entregar,
  paradaActual,
  cerrarLaVentana,
  type ParadaDeRuta,
} from "./pod-terreno.ts";
import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";

// El undo de 8 s con semántica CERRADA [AC-FPOD-08] — §4.7, §0, §10, §7.4.
//
// Las tres ramas del §4.7, cada una con la pregunta que la hace verdadera:
//
//   (a) undo DENTRO de la ventana ⇒ ¿queda algo en el aparato? No: la mutación se cancela ANTES
//       del replay y no sale.
//   (b) la app muere a los 3 s ⇒ ¿existe la captura al reabrir? Sí, y en `por_replicar`.
//   (c) undo DESPUÉS del replay ⇒ ¿se borra la original? Jamás: dos filas, con el supersede
//       apuntando a la primera y motivo `undo`.

function paradas(n: number): ParadaDeRuta[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `parada-${i}`,
    orden: i,
    destino: `Destino ${i}`,
    ventana: null,
    bultos: 1,
    items: [],
    requisitos: [],
  }));
}

function sello(uuid: string) {
  return { clientUuid: uuid, tsDispositivo: "2026-08-11T12:00:00.000Z", tzOffsetMin: -240 };
}

/** Un `Storage` de tres líneas: lo que este AC prueba es la durabilidad, no el navegador. */
function almacen(): AlmacenLocal & { crudo(): string | null } {
  let guardado: string | null = null;
  return {
    getItem: () => guardado,
    setItem: (_llave, valor) => {
      guardado = valor;
    },
    crudo: () => guardado,
  };
}

test("[AC-FPOD-08] la captura se escribe INMEDIATAMENTE al outbox con estado pending_undo", () => {
  const r = entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1"));

  const outbox = outboxDeRecorrido(r);
  assert.equal(outbox.length, 1, "el toque ya dejó la captura en el outbox, no al vencer la ventana");
  assert.equal(outbox[0]!.estado, UNDO.estado_local);
  assert.equal(outbox[0]!.supersedeDe, null, "una captura de terreno no corrige a ninguna otra");
  assert.equal(outbox[0]!.motivoSupersede, null);
});

test("[AC-FPOD-08] undo DENTRO de la ventana: la mutación se cancela y jamás sale del dispositivo", () => {
  const r = entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1"));
  const resultado = deshacerCaptura(r, sello("uuid-del-undo"));

  assert.equal(resultado.tipo, "cancelada");
  assert.deepEqual(outboxDeRecorrido(resultado.recorrido), [], "cancelada ANTES del replay: cero rastro");
  assert.equal(
    paradaActual(resultado.recorrido)?.id,
    "parada-0",
    "y devuelve al chofer a la parada donde se equivocó de botón",
  );
});

test("[AC-FPOD-08] la app muere a los 3 s: al reabrir la captura existe y queda para replay", () => {
  const disco = almacen();
  const r = entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1"));
  // El efecto de la pantalla, sin la pantalla: se guarda en el mismo gesto. Y acá la app muere —
  // nadie llama a `cerrarLaVentana`, porque el temporizador de los 8 s se fue con el proceso.
  guardarOutbox(disco, outboxDeRecorrido(r));

  const alAbrir = colaAlArrancar(leerOutbox(disco));
  assert.equal(alAbrir.length, 1, "la mutación EXISTE al reabrir: no se perdió con el proceso");
  assert.equal(alAbrir[0]!.clientUuid, "uuid-1");
  assert.equal(
    alAbrir[0]!.estado,
    "por_replicar",
    "y se replayea: la ventana era del gesto, no del archivo — nadie deshace lo de ayer",
  );

  const reabierto = iniciarRecorrido(paradas(3), 1, alAbrir);
  assert.equal(reabierto.cola.length, 1, "el recorrido reabierto arranca con la cola que el disco traía");
  assert.equal(reabierto.captura, null, "y sin ventana abierta: el arrepentimiento no sobrevive al cierre");
});

test("[AC-FPOD-08] undo DESPUÉS del replay: supersede con motivo undo, 2 filas y la original intacta", () => {
  const conVentanaVencida = cerrarLaVentana(entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1")));
  const resultado = deshacerCaptura(conVentanaVencida, sello("uuid-del-undo"));

  assert.equal(resultado.tipo, "supersedida", "el hecho ya salió: borrarlo sería reescribir el pasado (§7.4)");
  const outbox = outboxDeRecorrido(resultado.recorrido);
  assert.equal(outbox.length, 2, "dos filas");
  const [original, supersede] = outbox;
  assert.equal(original!.clientUuid, "uuid-1", "la original queda INTACTA");
  assert.equal(original!.supersedeDe, null);
  assert.equal(supersede!.clientUuid, "uuid-del-undo", "el supersede es un hecho nuevo con su propia llave (§0)");
  assert.equal(supersede!.supersedeDe, "uuid-1");
  assert.equal(supersede!.motivoSupersede, UNDO.motivo_supersede);
  assert.equal(supersede!.paradaId, original!.paradaId);
});

test("[AC-FPOD-08] una captura ya supersedida no se vuelve a deshacer", () => {
  const vencida = cerrarLaVentana(entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1")));
  const primero = deshacerCaptura(vencida, sello("uuid-del-undo"));
  const segundo = deshacerCaptura(primero.recorrido, sello("uuid-del-undo-2"));

  assert.equal(segundo.tipo, "nada", "dos correcciones del mismo hecho lo contarían dos veces en el §10");
  assert.equal(outboxDeRecorrido(segundo.recorrido).length, 2);
});

test("[AC-FPOD-08] sin nada que deshacer el toque no inventa una corrección", () => {
  const resultado = deshacerCaptura(iniciarRecorrido(paradas(3)), sello("uuid-del-undo"));
  assert.equal(resultado.tipo, "nada");
  assert.deepEqual(outboxDeRecorrido(resultado.recorrido), []);
});

test("[AC-FPOD-08] el supersede se hace sobre la ÚLTIMA captura sin corregir, no sobre la primera", () => {
  let r = cerrarLaVentana(entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1")));
  r = cerrarLaVentana(entregar(llegar(r), sello("uuid-2")));
  const resultado = deshacerCaptura(r, sello("uuid-del-undo"));

  assert.equal(resultado.tipo, "supersedida");
  assert.equal(
    outboxDeRecorrido(resultado.recorrido).at(-1)!.supersedeDe,
    "uuid-2",
    "el dedo que llega tarde deshace la parada que acababa de cerrar, no la de hace tres cuadras",
  );
});

test("[AC-FPOD-08] un outbox guardado ilegible no se replayea como si fueran entregas", () => {
  const disco = almacen();
  disco.setItem("flota.outbox.pod", '[{"clientUuid":"a"},"basura",null]');
  assert.deepEqual(leerOutbox(disco), [], "una captura sin doble reloj ni estado no tiene llave con la que replayar");

  disco.setItem("flota.outbox.pod", "{no es json");
  assert.deepEqual(leerOutbox(disco), []);
});

test("[AC-FPOD-08] el ida y vuelta por el disco conserva la captura entera", () => {
  const disco = almacen();
  const r = entregar(llegar(iniciarRecorrido(paradas(3))), sello("uuid-1"));
  guardarOutbox(disco, outboxDeRecorrido(r));

  const [leida] = leerOutbox(disco);
  assert.deepEqual(leida, outboxDeRecorrido(r)[0]);
});
