import { test } from "node:test";
import assert from "node:assert/strict";
import { vaciarOutboxAjeno } from "./outbox-multiusuario.ts";
import { leerOutbox, guardarOutbox, type AlmacenLocal, type Identidad } from "./outbox-local.ts";
import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";

// El replay de identidades AJENAS [AC-FPOD-09] — §4.7: «las capturas de A persisten firmadas
// por el enrolamiento y se replayean AUNQUE B ESTÉ AUTENTICADO». Centinela 9 obligatorio (§9.3):
// A captura 3 mutaciones offline → B se autentica en el mismo dispositivo → vuelve la red → las
// 3 filas de A existen (count=3).
//
// Acá se prueba el ALGORITMO con un `Enviar` de mentira —sin red ni servidor, mismo patrón que
// `cliente/outbox.test.ts` no tiene pero que `replayar` ya usa—: lo que centinela 9 exige del
// SERVIDOR (que las filas aterricen) lo prueba `e2e/pod-outbox-multiusuario.spec.ts` contra el
// servidor real.

const A: Identidad = { tenant: "hechos.localhost", usuario: "hash-de-a" };
const B: Identidad = { tenant: "hechos.localhost", usuario: "hash-de-b" };

function almacen(): AlmacenLocal {
  const datos = new Map<string, string>();
  return {
    getItem: (llave) => datos.get(llave) ?? null,
    setItem: (llave, valor) => {
      datos.set(llave, valor);
    },
  };
}

function captura(clientUuid: string, estado: "pending_undo" | "por_replicar" = "por_replicar") {
  return {
    clientUuid,
    paradaId: "parada-de-a",
    tsDispositivo: "2026-08-11T12:00:00.000Z",
    tzOffsetMin: -240,
    resultado: "exito" as const,
    metodoEntrega: "receptor" as const,
    motivoId: null,
    items: null,
    evidencias: [],
    estado,
    supersedeDe: null,
    motivoSupersede: null,
  };
}

/** Un `Enviar` que acusa cada captura que le llega, y cuenta cuántas veces se llamó. */
function enviarQueAceptaTodo() {
  const cuerpos: string[] = [];
  const enviar = async (cuerpo: string) => {
    cuerpos.push(cuerpo);
    const enviado = JSON.parse(cuerpo) as { capturas: { client_uuid: string }[] };
    const acuses = enviado.capturas.map((c) => ({ client_uuid: c.client_uuid, aceptada: true }));
    return new Response(JSON.stringify({ acuses }), { status: 200 });
  };
  return { enviar, cuerpos };
}

test("[AC-FPOD-09] A captura 3 offline, B se autentica: las 3 de A se replayean igual", async () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("a-1"), captura("a-2"), captura("a-3")]);
  // B se autentica en el mismo aparato: su propio outbox arranca vacío, como el de cualquier
  // identidad recién autenticada — el §4.7 no le exige traer nada.
  guardarOutbox(disco, B, []);

  const { enviar, cuerpos } = enviarQueAceptaTodo();
  await vaciarOutboxAjeno(disco, B, enviar);

  assert.equal(cuerpos.length, 1, "un solo lote para la identidad ajena");
  const enviado = JSON.parse(cuerpos[0]!) as { capturas: { client_uuid: string }[] };
  assert.deepEqual(
    enviado.capturas.map((c) => c.client_uuid).sort(),
    ["a-1", "a-2", "a-3"],
    "las 3 mutaciones de A viajan, aunque quien esté autenticado ahora sea B",
  );
});

test("[AC-FPOD-09] tras el replay confirmado, el outbox de A queda vacío y el de B intacto", async () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("a-1"), captura("a-2"), captura("a-3")]);
  guardarOutbox(disco, B, [captura("b-1")]);

  await vaciarOutboxAjeno(disco, B, enviarQueAceptaTodo().enviar);

  assert.deepEqual(leerOutbox(disco, A), [], "confirmadas, salen de la cola local — ya están en el servidor");
  assert.equal(
    leerOutbox(disco, B).length,
    1,
    "el outbox de LA IDENTIDAD ACTIVA no lo toca este flush: lo vacía el replay normal de la pantalla",
  );
});

test("[AC-FPOD-09] una captura pending_undo de una identidad ajena SÍ replayea: la ventana era del gesto", async () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("a-1", UNDO.estado_local)]);
  guardarOutbox(disco, B, []);

  const { cuerpos } = await (async () => {
    const par = enviarQueAceptaTodo();
    await vaciarOutboxAjeno(disco, B, par.enviar);
    return par;
  })();

  assert.equal(cuerpos.length, 1, "nadie va a deshacer el toque de A desde el aparato de B");
  assert.deepEqual(leerOutbox(disco, A), [], "y queda replayada, no atascada en pending_undo para siempre");
});

test("[AC-FPOD-09] si el envío falla, la cola ajena queda intacta para el próximo intento", async () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("a-1")]);
  guardarOutbox(disco, B, []);

  const enviarQueFalla = async () => new Response(null, { status: 500 });
  await vaciarOutboxAjeno(disco, B, enviarQueFalla);

  assert.equal(leerOutbox(disco, A).length, 1, "sin acuse, nada se saca de la cola (§5.7: cero rechazo a la vista)");
});

test("[AC-FPOD-09] sin identidades ajenas con outbox pendiente, no manda ningún lote", async () => {
  const disco = almacen();
  guardarOutbox(disco, B, []);
  let llamadas = 0;
  await vaciarOutboxAjeno(disco, B, async () => {
    llamadas += 1;
    return new Response(JSON.stringify({ acuses: [] }), { status: 200 });
  });
  assert.equal(llamadas, 0);
});

test("[AC-FPOD-09] sin identidad activa (aparato recién enrolado, sin sesión previa) igual vacía lo ajeno", async () => {
  const disco = almacen();
  guardarOutbox(disco, A, [captura("a-1")]);

  await vaciarOutboxAjeno(disco, null, enviarQueAceptaTodo().enviar);

  assert.deepEqual(leerOutbox(disco, A), []);
});
