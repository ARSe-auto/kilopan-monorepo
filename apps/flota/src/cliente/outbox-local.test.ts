import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leerOutbox,
  guardarOutbox,
  llaveOutboxPod,
  listarIdentidadesConOutbox,
  type AlmacenLocal,
  type Identidad,
} from "./outbox-local.ts";

// El outbox particionado por (tenant, usuario) [AC-FPOD-09] — §4.7, centinela 9 (§9.3).
//
// Lo que este archivo prueba es la LLAVE: dos identidades en el mismo `Storage` jamás se pisan,
// y el índice que permite encontrar «lo que otra identidad dejó» sin enumerar `localStorage`
// entero. La durabilidad en sí (que sobreviva a un cierre de app) ya la prueba `dominio/
// outbox-undo.test.ts` [AC-FPOD-08] — repetirla acá sería una segunda copia del mismo criterio.

const A: Identidad = { tenant: "hechos.localhost", usuario: "hash-de-a" };
const B: Identidad = { tenant: "hechos.localhost", usuario: "hash-de-b" };

/** Un `Storage` de tres líneas, con una segunda llave: acá interesa que DOS entradas convivan,
 *  no solo que una sobreviva. */
function almacen(): AlmacenLocal {
  const datos = new Map<string, string>();
  return {
    getItem: (llave) => datos.get(llave) ?? null,
    setItem: (llave, valor) => {
      datos.set(llave, valor);
    },
  };
}

function captura(clientUuid: string) {
  return {
    clientUuid,
    paradaId: "parada-1",
    tsDispositivo: "2026-08-11T12:00:00.000Z",
    tzOffsetMin: -240,
    secuenciaDispositivo: 1,
    resultado: "exito" as const,
    metodoEntrega: "receptor" as const,
    motivoId: null,
    items: null,
    evidencias: [],
    estado: "por_replicar" as const,
    supersedeDe: null,
    motivoSupersede: null,
  };
}

test("[AC-FPOD-09] dos identidades en el mismo aparato tienen llaves DISTINTAS", () => {
  assert.notEqual(llaveOutboxPod(A), llaveOutboxPod(B));
  assert.equal(llaveOutboxPod(A), llaveOutboxPod({ ...A }), "la misma identidad siempre da la misma llave");
});

test("[AC-FPOD-09] guardar el outbox de B jamás pisa el de A guardado antes", () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("de-a-1"), captura("de-a-2"), captura("de-a-3")]);

  // B se autentica en el mismo aparato y guarda SU outbox — vacío al principio, como cualquier
  // identidad recién autenticada.
  guardarOutbox(disco, B, []);

  assert.equal(
    leerOutbox(disco, A).length,
    3,
    "las 3 capturas de A siguen existiendo: autenticarse otra identidad NO las purgó (§4.7)",
  );
  assert.deepEqual(leerOutbox(disco, B), []);
});

test("[AC-FPOD-09] el outbox de A sigue leyéndose completo aunque B ya haya escrito el suyo", () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("de-a-1"), captura("de-a-2"), captura("de-a-3")]);
  guardarOutbox(disco, B, [captura("de-b-1")]);

  const deA = leerOutbox(disco, A);
  assert.equal(deA.length, 3);
  assert.deepEqual(
    deA.map((c) => c.clientUuid).sort(),
    ["de-a-1", "de-a-2", "de-a-3"],
  );
});

test("[AC-FPOD-09] el índice de identidades registra a A y a B sin duplicar", () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("de-a-1")]);
  guardarOutbox(disco, A, [captura("de-a-1"), captura("de-a-2")]); // A vuelve a guardar (una captura más)
  guardarOutbox(disco, B, [captura("de-b-1")]);

  const identidades = listarIdentidadesConOutbox(disco);
  assert.equal(identidades.length, 2, "A se registró una sola vez pese a guardar dos veces");
  assert.ok(identidades.some((i) => i.usuario === A.usuario));
  assert.ok(identidades.some((i) => i.usuario === B.usuario));
});

test("[AC-FPOD-09] sin ningún outbox guardado, el índice de identidades está vacío", () => {
  assert.deepEqual(listarIdentidadesConOutbox(almacen()), []);
});

test("[AC-FPOD-09] un índice ilegible no revienta: se lee como si nadie hubiera guardado nada", () => {
  const disco = almacen();
  disco.setItem("flota.outbox.identidades", "{no es json ni un arreglo");
  assert.deepEqual(listarIdentidadesConOutbox(disco), []);
});
