import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Regla de oro en el endpoint de sync, con reloj [AC-FPOD-05] — §4.2, §4.6, §0, §9.3 centinela 4.
//
// El drift de reloj es el único de los «casos probados» del AC que es nuevo para este módulo: el
// SOC fuera de rango y el odómetro retrocedido ya los cierra AC-FVEH-05 contra `reading`, y el
// POD no lleva ninguna de esas dos magnitudes. Lo que sí faltaba era que `/api/sync/capturas`
// mirara el doble reloj del §4.6 — antes de este AC una entrega con la hora del aparato corrida
// aterrizaba sin flag ni fila en «Por revisar».
//
// El invariante que este test ejerce es el centinela 4 con nombre: la captura degradada
// responde 200 igual (rechazos = 0) y la degradación queda DICHA, no escondida.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(12);
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien captura con el reloj corrido') returning id::text as id",
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

async function filasEnRevision(origen: string): Promise<number> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from review_queue where origen = $1", [origen]),
  );
  return Number(fila!.n);
}

test("[AC-FPOD-05] captura de POD con el reloj corrido: 2xx igual, con flag + evento + review_queue", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const paradaId = randomUUID();
  // Bien por encima de la tolerancia de RELOJ del §0, sin escribir su umbral acá — el borde
  // exacto se prueba con la constante importada en dominio/pod-sync.test.ts.
  const tsCorrido = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const respuesta = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: {
      capturas: [
        {
          client_uuid: clientUuid,
          parada_id: paradaId,
          ts_dispositivo: tsCorrido,
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

  // Centinela 4: rechazos = 0. La captura degradada responde 200, JAMÁS 4xx.
  expect(respuesta.status()).toBe(200);
  const acuse = (await respuesta.json()).acuses[0];
  expect(acuse.aceptada, "la regla de oro: CAPTURA jamás rebota, ni con el reloj corrido").toBe(true);

  expect(await eventosDeTipo(clientUuid, "entrega.pod_capturada")).toBe(1);
  expect(
    await eventosDeTipo(clientUuid, "entrega.reloj_desfasado"),
    "el drift tiene que quedar DICHO con su propio evento, no perderse en el jsonb",
  ).toBe(1);
  expect(
    await filasEnRevision("entrega.reloj_desfasado"),
    "y con una fila en «Por revisar» para que alguien la mire",
  ).toBeGreaterThanOrEqual(1);
});

test("[AC-FPOD-05] captura de POD con el reloj sincronizado: 2xx, sin flag ni fila en revisión", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const paradaId = randomUUID();

  const respuesta = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: {
      capturas: [
        {
          client_uuid: clientUuid,
          parada_id: paradaId,
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
  expect(
    await eventosDeTipo(clientUuid, "entrega.reloj_desfasado"),
    "una captura sana no tiene que marcar nada — la bandeja «Por revisar» tiende a cero",
  ).toBe(0);
});
