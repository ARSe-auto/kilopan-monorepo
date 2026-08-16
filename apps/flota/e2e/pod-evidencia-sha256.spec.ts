import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El contrato de transporte del binario de `evidence` [AC-FPOD-19] — §4.6, §7.6, §4.2.
//
// El §4.6 lo fija literal: «el sha256 viaja en la mutación ANTES del binario; mismatch al
// re-hashear ⇒ flag, no rebote». Mismo contrato que ya cierra AC-FRUT-10 para la foto de
// custodia (`servidor/manifiestos.ts::registrarFotoDeManifiesto`) — acá es el mismo transporte
// para una evidencia de una parada de POD.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(20);
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien sube evidencia de POD') returning id::text as id",
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

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function capturarParada(request: import("@playwright/test").APIRequestContext, evidencias: unknown[]) {
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
          evidencias,
        },
      ],
    },
  });
  expect(respuesta.status()).toBe(200);
  return { paradaId, clientUuid };
}

async function eventosDeTipo(paradaId: string, codigo: string): Promise<number> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n
         from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = $2 and e.objeto_tabla = 'paradas' and e.objeto_id = $1`,
      [paradaId, codigo],
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

test("[AC-FPOD-19] el binario que no re-hashea entra igual, con el hash REAL y su flag", async ({ request }) => {
  const laQueSubio = Buffer.from("el binario que efectivamente llegó del terreno");
  const laQuePrometio = Buffer.from("la foto que el aparato dijo que iba a subir");

  const { paradaId } = await capturarParada(request, [
    { requisitoId: "r1", tipo: "foto", sha256: sha(laQuePrometio) },
  ]);

  const clientUuidEvidencia = randomUUID();
  const subida = await request.post(`/api/paradas/${paradaId}/evidencia`, {
    headers: comoChofer,
    data: {
      requisito_id: "r1",
      contenido_b64: laQueSubio.toString("base64"),
      client_uuid: clientUuidEvidencia,
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });

  // La foto es mejora progresiva del §7.6, jamás dependencia: un binario que no calza no puede
  // invalidar la entrega, que ya se cerró.
  expect(subida.status()).toBe(201);
  const evidencia = (await subida.json()) as { evidence_id: string; flags: string[] };
  expect(evidencia.flags).toEqual(["sha256_mismatch"]);

  expect(await eventosDeTipo(paradaId, "entrega.sha256_mismatch")).toBe(1);
  expect(await filasEnRevision("entrega.sha256_mismatch")).toBeGreaterThanOrEqual(1);

  await con(BD_A, async (c: Conexion) => {
    const [e] = await c.sql<{ sha: string }>(
      "select encode(sha256, 'hex') as sha from evidence where id = $1",
      [evidencia.evidence_id],
    );
    // Se guarda el hash REAL, el de los bytes que efectivamente llegaron — no el prometido.
    expect(e!.sha).toBe(sha(laQueSubio));
    expect(e!.sha).not.toBe(sha(laQuePrometio));
  });

  // Replay del outbox: el MISMO client_uuid no degrada dos veces.
  const repetida = await request.post(`/api/paradas/${paradaId}/evidencia`, {
    headers: comoChofer,
    data: {
      requisito_id: "r1",
      contenido_b64: laQueSubio.toString("base64"),
      client_uuid: clientUuidEvidencia,
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  expect(repetida.status()).toBe(200);
  expect((await repetida.json()) as { repetida: boolean }).toMatchObject({ repetida: true });
  expect(await eventosDeTipo(paradaId, "entrega.sha256_mismatch")).toBe(1);
});

test("[AC-FPOD-19] el binario que SÍ re-hashea igual no degrada — el sha256 viaja ANTES del binario", async ({
  request,
}) => {
  const laQueSubio = Buffer.from("el binario correcto, sin sorpresas");

  const { paradaId } = await capturarParada(request, [
    { requisitoId: "r1", tipo: "foto", sha256: sha(laQueSubio) },
  ]);

  const limpia = await request.post(`/api/paradas/${paradaId}/evidencia`, {
    headers: comoChofer,
    data: {
      requisito_id: "r1",
      contenido_b64: laQueSubio.toString("base64"),
      client_uuid: randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  expect(limpia.status()).toBe(201);
  expect((await limpia.json()) as { flags: string[] }).toMatchObject({ flags: [] });
  expect(await eventosDeTipo(paradaId, "entrega.sha256_mismatch")).toBe(0);
});

test("[AC-FPOD-19] una evidencia sin promesa de binario (firma) no tiene con qué comparar — sin flag", async ({
  request,
}) => {
  const { paradaId } = await capturarParada(request, [{ requisitoId: "r1", tipo: "firma" }]);

  const subida = await request.post(`/api/paradas/${paradaId}/evidencia`, {
    headers: comoChofer,
    data: {
      requisito_id: "r1",
      contenido_b64: Buffer.from("la firma capturada").toString("base64"),
      client_uuid: randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  expect(subida.status()).toBe(201);
  expect((await subida.json()) as { flags: string[] }).toMatchObject({ flags: [] });
});

test("[AC-FPOD-19] un requisito que la parada nunca declaró no existe — 404, sin escribir nada", async ({
  request,
}) => {
  const { paradaId } = await capturarParada(request, [{ requisitoId: "r1", tipo: "foto" }]);

  const respuesta = await request.post(`/api/paradas/${paradaId}/evidencia`, {
    headers: comoChofer,
    data: {
      requisito_id: "requisito-inventado",
      contenido_b64: Buffer.from("cualquier cosa").toString("base64"),
      client_uuid: randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  expect(respuesta.status()).toBe(404);
});
