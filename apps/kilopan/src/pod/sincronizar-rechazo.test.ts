// P0-2 (auditoría 1-ago-2026 · campaña correctiva, Ola 0): sincronizar() borraba
// (`quitar()`) un ítem de la cola en cuanto el servidor lo rechazaba con 4xx —el caso
// típico es una venta cobrada en EFECTIVO sin red, que al volver la señal rebota con
// 409 "stock insuficiente"— sin dejar ningún rastro persistente. El único aviso era
// un mensaje efímero de React (`pesar/page.tsx`, `vender/page.tsx`) que la siguiente
// tecla o el siguiente ciclo de sync (cada 30s) pisaba. Plata ya cobrada, sin ninguna
// venta registrada en ningún lado.
//
// Este test importa el módulo REAL (import "fake-indexeddb/auto" + el hook de alias
// de scripts/resolver-alias-tests.mjs — correr con:
//   node --import ./scripts/resolver-alias-tests.mjs --test src/pod/sincronizar-rechazo.test.ts
// No reimplementa la lógica en un Map, a diferencia de outbox.test.ts (limitación
// documentada ahí mismo: "el outbox usa IndexedDB, que no existe en Node" — ya no es
// cierto con fake-indexeddb).
import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { encolar, sincronizar, listarPendientes, listarRechazados } from "./outbox.ts";

function respuesta409(motivo: string) {
  return new Response(JSON.stringify({ error: motivo }), { status: 409 });
}

test("P0-2: una venta rechazada con 409 al sincronizar NO desaparece — queda en rechazados", async (t) => {
  const clientUuid = "22222222-2222-4222-8222-222222222222";
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () => respuesta409("Stock insuficiente (disponible: 0 g)")) as typeof fetch;

  await encolar({
    clientUuid,
    tipo: "venta",
    ruta: "/api/ventas",
    payload: { clientUuid, medioPago: "efectivo", lineas: [] },
  });

  const resultado = await sincronizar();

  assert.equal(resultado.rechazadas.length, 1, "sincronizar() debe reportar el rechazo");
  assert.equal(resultado.rechazadas[0]?.clientUuid, clientUuid);

  const pendientes = await listarPendientes();
  assert.equal(pendientes.length, 0, "sale de la cola de reintento — no hay que insistir en un 409 de negocio");

  // El punto del hallazgo: el ítem no se esfumó, quedó en algún lado que se puede leer.
  const rechazados = await listarRechazados();
  assert.equal(rechazados.length, 1, "el rechazo debe quedar persistido, no solo reportado en memoria");
  assert.equal(rechazados[0]?.clientUuid, clientUuid);
  assert.equal(rechazados[0]?.tipo, "venta");
  assert.equal(rechazados[0]?.motivo, "Stock insuficiente (disponible: 0 g)");
  assert.deepEqual(
    rechazados[0]?.payload,
    { clientUuid, medioPago: "efectivo", lineas: [] },
    "el payload completo de la venta debe sobrevivir — es lo único que prueba qué se cobró"
  );
});

test("control: una venta que el servidor ACEPTA no queda en rechazados", async (t) => {
  const clientUuid = "33333333-3333-4333-8333-333333333333";
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () => new Response(JSON.stringify({ id: "venta-1", totalClp: 1000 }), { status: 200 })) as typeof fetch;

  await encolar({ clientUuid, tipo: "venta", ruta: "/api/ventas", payload: { clientUuid } });
  const resultado = await sincronizar();

  assert.equal(resultado.enviadas, 1);
  assert.equal((await listarPendientes()).length, 0);
  assert.equal(
    (await listarRechazados()).filter((r) => r.clientUuid === clientUuid).length,
    0,
    "una venta aceptada no debe aparecer en la bandeja de rechazos"
  );
});
