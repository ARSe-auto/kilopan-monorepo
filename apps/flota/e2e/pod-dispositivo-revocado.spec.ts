import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { REVOCACION } from "../../../packages/nucleo-comun/src/constants.ts";
import { TENANTS } from "./preparar-tenants.mjs";

// Capturas offline de un aparato ya revocado [AC-FPOD-07] — §4.3, §4.2, centinela 4 §9.3.
//
// El corte del §5.4 F-F (AC-FIDN-09) es SECO hacia adelante: el request siguiente del aparato
// revocado no tiene sesión, sin gracia. Pero la captura que ese mismo aparato trae de ANTES de
// la revocación no es un request nuevo, es trabajo del terreno que ya ocurrió — y el §4.2
// prohíbe de frente que una CAPTURA rebote. `sesionParaSincronizarCapturas` (servidor/gobierno.ts)
// es la única guardia que deja pasar esa sesión "revocada" hasta `/api/sync/capturas`, y
// `dominio/pod-sync.ts` (reusando `dominio/revocacion.ts`, AC-FIDN-09) decide la severidad —
// nunca si entra.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

async function enrolarChoferRevocado(rut: string, secreto: string, revocadoEn: Date): Promise<void> {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien captura tras la revocación') returning id::text as id",
      [rut],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted, revocado_at)
       values ('personal', $1, $2, $3, now(), true, true, $4)`,
      [p!.id, hashDeSecreto(secreto), u!.id, revocadoEn],
    );
  });
}

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

async function filasEnRevision(origen: string): Promise<{ n: number; severidad: string | null }> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string; severidad: string | null }>(
      "select count(*)::text as n, max(severidad) as severidad from review_queue where origen = $1",
      [origen],
    ),
  );
  return { n: Number(fila!.n), severidad: fila!.severidad };
}

test("[AC-FPOD-07] captura DENTRO de la ventana de 72h: 2xx en cuarentena, sin evento propio ni fila en revisión", async ({
  request,
}) => {
  const rut = rutDeFixture(14);
  const secreto = secretoNuevo();
  // Revocado hace 1 hora: bien dentro de la ventana de REVOCACION.ventana_horas (§0).
  const revocadoEn = new Date(Date.now() - 1 * 3_600_000);
  await enrolarChoferRevocado(rut, secreto, revocadoEn);

  const clientUuid = randomUUID();
  const paradaId = randomUUID();
  const respuesta = await request.post("/api/sync/capturas", {
    headers: { Authorization: `Portador ${secreto}` },
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

  // Centinela 4: rechazos = 0. Un aparato revocado NO pierde el trabajo que ya hizo en terreno.
  expect(respuesta.status()).toBe(200);
  const acuse = (await respuesta.json()).acuses[0];
  expect(acuse.aceptada, "la captura de un aparato revocado JAMÁS rebota (§4.2, §4.3)").toBe(true);
  expect(acuse.flags).toContain("post_revocacion");

  expect(await eventosDeTipo(clientUuid, "entrega.pod_capturada")).toBe(1);
  const revision = await filasEnRevision("entrega.post_revocacion");
  expect(
    revision.n,
    "dentro de la ventana la captura se explica por falta de señal: NO abre fila de revisión",
  ).toBe(0);
});

test("[AC-FPOD-07] captura FUERA de la ventana de 72h: 2xx con severidad alta, evento y fila en revisión", async ({
  request,
}) => {
  const rut = rutDeFixture(15);
  const secreto = secretoNuevo();
  // Bien pasada la ventana: ya no se explica por falta de señal, es un incidente.
  const revocadoEn = new Date(Date.now() - (REVOCACION.ventana_horas + 10) * 3_600_000);
  await enrolarChoferRevocado(rut, secreto, revocadoEn);

  const clientUuid = randomUUID();
  const paradaId = randomUUID();
  const respuesta = await request.post("/api/sync/capturas", {
    headers: { Authorization: `Portador ${secreto}` },
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
  const acuse = (await respuesta.json()).acuses[0];
  expect(acuse.aceptada, "la distinción es SOLO severidad de revisión — jamás rechazo").toBe(true);
  expect(acuse.flags).toContain("post_revocacion_tardia");

  expect(await eventosDeTipo(clientUuid, "entrega.pod_capturada")).toBe(1);
  expect(
    await eventosDeTipo(clientUuid, "entrega.post_revocacion_tardia"),
    "pasada la ventana, la degradación tiene que quedar DICHA con su propio evento",
  ).toBe(1);
  const revision = await filasEnRevision("entrega.post_revocacion_tardia");
  expect(revision.n, "y con una fila en «Por revisar» para que alguien la mire").toBeGreaterThanOrEqual(1);
  expect(revision.severidad).toBe("alta");
});
