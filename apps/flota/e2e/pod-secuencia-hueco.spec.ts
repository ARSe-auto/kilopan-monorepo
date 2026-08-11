import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Secuencia monotónica por dispositivo [AC-FPOD-10] — §4.7, §9.3 centinela 4.
//
// Un hueco es evicción del outbox o manipulación, NUNCA pérdida silenciosa: la captura aterriza
// igual (centinela 4: rechazos = 0) y lo único que cambia es que queda flag + evento + fila en
// «Por revisar».

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(13);
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien deja un hueco en la secuencia') returning id::text as id",
      [RUT_CHOFER],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
  });
});

async function eventosDeTipo(clientUuid: string, codigo: string): Promise<number> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n
         from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = $2
          and e.objeto_id = (select objeto_id from eventos where client_uuid = $1)`,
      [clientUuid, codigo],
    ),
  );
  return Number(fila!.n);
}

function captura(clientUuid: string, secuenciaDispositivo: number) {
  return {
    client_uuid: clientUuid,
    parada_id: randomUUID(),
    ts_dispositivo: new Date().toISOString(),
    tz_offset_min: -240,
    resultado: "exito",
    metodo_entrega: "receptor",
    motivo_id: null,
    items: null,
    evidencias: [],
    secuencia_dispositivo: secuenciaDispositivo,
  };
}

test("[AC-FPOD-10] secuencia consecutiva del mismo dispositivo: 2xx, sin flag ni fila en revisión", async ({
  request,
}) => {
  const c1 = randomUUID();
  const c2 = randomUUID();

  const r1 = await request.post("/api/sync/capturas", { headers: comoChofer, data: { capturas: [captura(c1, 1)] } });
  expect(r1.status()).toBe(200);
  const r2 = await request.post("/api/sync/capturas", { headers: comoChofer, data: { capturas: [captura(c2, 2)] } });
  expect(r2.status()).toBe(200);

  expect(await eventosDeTipo(c1, "entrega.pod_capturada")).toBe(1);
  expect(await eventosDeTipo(c2, "entrega.pod_capturada")).toBe(1);
  expect(
    await eventosDeTipo(c2, "entrega.secuencia_hueco"),
    "consecutiva de verdad: nada que revisar",
  ).toBe(0);
});

test("[AC-FPOD-10] un hueco en la secuencia: 2xx igual, con flag + evento + review_queue — rechazos = 0 (centinela 4)", async ({
  request,
}) => {
  const c1 = randomUUID();
  const c2 = randomUUID();

  await request.post("/api/sync/capturas", { headers: comoChofer, data: { capturas: [captura(c1, 10)] } });
  // Se saltó del 10 al 15: cinco números que nunca aterrizaron — evicción del outbox o
  // manipulación, y el AC pide dejarlo DICHO, no perderlo en silencio.
  const respuesta = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: { capturas: [captura(c2, 15)] },
  });

  expect(respuesta.status()).toBe(200);
  const acuse = (await respuesta.json()).acuses[0];
  expect(acuse.aceptada, "la regla de oro: CAPTURA jamás rebota, ni con un hueco de secuencia").toBe(true);
  expect(acuse.flags).toContain("secuencia_hueco");

  expect(await eventosDeTipo(c2, "entrega.pod_capturada")).toBe(1);
  expect(
    await eventosDeTipo(c2, "entrega.secuencia_hueco"),
    "el hueco tiene que quedar DICHO con su propio evento, no perderse en el jsonb",
  ).toBe(1);

  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from review_queue where origen = 'entrega.secuencia_hueco'"),
  );
  expect(Number(fila!.n), "y con una fila en «Por revisar» para que alguien la mire").toBeGreaterThanOrEqual(1);
});

test("[AC-FPOD-10] una captura sin secuencia (PWA vieja) no dispara nada: no es motivo de rebote", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const respuesta = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: {
      capturas: [
        {
          client_uuid: clientUuid,
          parada_id: randomUUID(),
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -240,
          resultado: "exito",
          metodo_entrega: "receptor",
          motivo_id: null,
          items: null,
          evidencias: [],
        },
      ],
    },
  });

  expect(respuesta.status()).toBe(200);
  expect((await respuesta.json()).acuses[0].aceptada).toBe(true);
  expect(await eventosDeTipo(clientUuid, "entrega.pod_capturada")).toBe(1);
  expect(await eventosDeTipo(clientUuid, "entrega.secuencia_hueco")).toBe(0);
});

// ─── Background Sync no existe en esta app: replay-on-startup/online ya es el camino principal ──
//
// El §4.7 exige que la suite offline completa pase con Background Sync deshabilitada (Safari no
// la tiene). Esta app no registra Background Sync en ningún lugar (grep de `apps/flota/src` sin
// resultados): el camino de replay son los dos disparos de `tarjeta-de-entrega.tsx` — al montar y
// al volver la señal (`window.addEventListener("online", …)`) — y NINGUNO depende de una API de
// service worker. Este test lo deja EXPLÍCITO borrando `navigator.serviceWorker` antes de que la
// pantalla cargue: si algún día alguien acopla el replay a Background Sync, la cola deja de
// vaciarse acá y el gate lo nota.
test("[AC-FPOD-10] con Background Sync inexistente en el navegador, el replay-on-online igual vacía la cola", async ({
  page,
}) => {
  const RUT = rutDeFixture(14);
  const SECRETO_2 = secretoNuevo();

  const [{ id: paradaId, destino }] = await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien maneja sin Background Sync') returning id::text as id",
      [RUT],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO_2), u!.id],
    );
    const [destinoRow] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Destino sin Background Sync') returning id::text as id",
      [],
    );
    const [r] = await c.sql<{ id: string }>(
      "insert into rutas (nombre, publicada_en, version) values ('ruta sin background sync', now(), 1) returning id::text as id",
      [],
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [r!.id, destinoRow!.id],
    );
    return [{ id: parada!.id, destino: "Destino sin Background Sync" }];
  });

  await page.addInitScript((secreto) => {
    // @ts-expect-error — borrado deliberado para probar que el replay no depende de esta API.
    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
    const guardar = () =>
      new Promise<void>((res) => {
        const r = indexedDB.open("flota-aparato", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("claves");
        r.onsuccess = () => {
          const tx = r.result.transaction("claves", "readwrite").objectStore("claves").put(secreto, "secreto-de-sesion");
          tx.onsuccess = () => res();
          tx.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO_2);

  await page.goto(`/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.context().setOffline(true);
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
  await expect(page.getByTestId("contador-cola")).toHaveText("1", { timeout: 15_000 });

  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByTestId("por-sincronizar")).toHaveCount(0, { timeout: 15_000 });
  const idsBusqueda = [paradaId];
  await expect
    .poll(
      async () =>
        con(BD_A, (c: Conexion) =>
          c
            .sql<{ n: string }>(
              `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
                where t.codigo = 'entrega.pod_capturada' and e.objeto_id = any($1::uuid[])`,
              [idsBusqueda],
            )
            .then((f) => Number(f[0]!.n)),
        ),
      { timeout: 15_000 },
    )
    .toBe(1);
});
