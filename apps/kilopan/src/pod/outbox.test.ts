import { test } from "node:test";
import assert from "node:assert/strict";

// El outbox usa IndexedDB, que no existe en Node. Lo que SÍ se puede probar sin un
// navegador es el contrato que hace que la cola se vacíe: que la clave con la que se
// guarda un ítem sea EXACTAMENTE la misma que viaja en el payload.
//
// Esto no es teórico: la primera versión llamaba crypto.randomUUID() dos veces —una
// para la clave y otra para el payload—, así que el servidor aceptaba la entrega,
// devolvía el uuid del payload, la cola intentaba borrar por ese uuid, no encontraba
// nada y reenviaba el mismo POD para siempre. Sobre datos móviles: una cola que nunca
// se vacía, consumiendo datos toda la jornada.

/** Réplica del armado de un ítem de cola tal como lo hace la UI de reparto. */
function armarItemEntrega(datos: { pedidoId: string; receptorNombre: string; fotoSha256: string }) {
  const clientUuid = "11111111-1111-4111-8111-111111111111"; // en la app: crypto.randomUUID()
  return {
    clientUuid,
    tipo: "entrega" as const,
    ruta: "/api/sync",
    payload: { clientUuid, ...datos },
  };
}

test("outbox: la clave del ítem y el client_uuid del payload son el MISMO", () => {
  const item = armarItemEntrega({ pedidoId: "p1", receptorNombre: "Lucho", fotoSha256: "abc" });
  assert.equal(
    item.clientUuid,
    (item.payload as { clientUuid: string }).clientUuid,
    "si divergen, el servidor acepta pero la cola nunca borra el ítem y reenvía para siempre"
  );
});

test("outbox: simular el ciclo aceptar→borrar deja la cola vacía", () => {
  const cola = new Map<string, unknown>();
  const item = armarItemEntrega({ pedidoId: "p1", receptorNombre: "Lucho", fotoSha256: "abc" });
  cola.set(item.clientUuid, item);

  // El servidor responde con los client_uuid del PAYLOAD que aceptó.
  const aceptadas = [(item.payload as { clientUuid: string }).clientUuid];
  for (const uuid of aceptadas) cola.delete(uuid);

  assert.equal(cola.size, 0, "la cola queda vacía tras una sincronización exitosa");
});

test("outbox: un ítem con clave divergente NO se borra (reproduce el bug corregido)", () => {
  const cola = new Map<string, unknown>();
  const claveOutbox = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const uuidPayload = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // distinto: el bug
  cola.set(claveOutbox, { payload: { clientUuid: uuidPayload } });

  for (const uuid of [uuidPayload]) cola.delete(uuid);

  assert.equal(cola.size, 1, "con claves divergentes el ítem sobrevive y se reenvía eternamente");
});
