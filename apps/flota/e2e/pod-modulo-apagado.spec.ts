import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Módulo apagado con turno abierto, sobre la captura de POD [AC-FPOD-06] — §0 HTTP, §5.5, §4.4.
//
// Mismo criterio que AC-FVEH-18 (`lecturas.ts`) y AC-FRUT-10 (`manifiestos.ts`/`custodia.ts`),
// aplicado a `/api/sync/capturas`: la entrega es CAPTURA (§4.2), así que un módulo apagado
// NUNCA la rebota — entra 2xx con flag `modulo_apagado`, su fila en «Por revisar», y la
// respuesta manda `turno.config_version_id` para que quien la mire después sepa CON QUÉ
// configuración se juzgó.
//
// ─── EL CASO «SNAPSHOT CONGELADO» (§9.2), Y NO SOLO «HOY ESTÁ APAGADO» ──────────────
//
// El §4.4 dice que un turno corre ENTERO con UNA versión y que los cambios aplican al turno
// SIGUIENTE. El test de abajo prueba exactamente eso: el turno abre con una versión APAGADA, y
// LUEGO se sella una versión nueva ENCENDIDA — con el turno todavía abierto. Si la captura se
// juzgara contra la vigente (la nueva, encendida), este caso saldría limpio: sería la confusión
// exacta que el §4.4 existe para prevenir. La prueba real de «congelado» no es que el flag
// aparezca, es que aparezca A PESAR de que la config de ahora dice lo contrario.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(13);
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien captura con el módulo apagado') returning id::text as id",
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

/** Un turno abierto con la config CONGELADA que el caso necesita, sobre un vehículo propio. */
async function turnoConConfig(
  patente: string,
  entitlements: Record<string, boolean>,
): Promise<{ turnoId: string; configVersionId: string }> {
  return con(BD_A, async (c: Conexion) => {
    const [v] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [patente],
    );
    // El centinela 5 impide dos turnos vivos del mismo vehículo: una corrida anterior de esta
    // suite anula el suyo, que es la vía que el §4.5 deja abierta para un turno que no debió
    // seguir ocupando el día.
    await c.sql("update turnos set estado = 'anulado' where vehiculo_id = $1 and estado = 'abierto'", [
      v!.id,
    ]);
    const [version] = await c.sql<{ id: string }>(
      "select crear_config_version($1, $2::jsonb)::text as id",
      ["fixture del e2e de AC-FPOD-06", JSON.stringify(entitlements)],
    );
    const [t] = await c.sql<{ id: string }>(
      "insert into turnos (vehiculo_id, config_version_id) values ($1, $2) returning id::text as id",
      [v!.id, version!.id],
    );
    return { turnoId: t!.id, configVersionId: version!.id };
  });
}

test("[AC-FPOD-06] módulo apagado en la config congelada del turno: 2xx, flag y config_version_id del turno, no de la vigente", async ({
  request,
}) => {
  const { turnoId, configVersionId } = await turnoConConfig("KLPD06", { modulo_encargos: false });

  // Y una versión NUEVA encendida encima, con el turno YA corriendo: si la captura se juzgara
  // con la vigente, este caso saldría limpio — exactamente la confusión que el §4.4 previene
  // congelando la config en el turno.
  await con(BD_A, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "el dueño lo volvió a encender, con el turno ya corriendo",
      JSON.stringify({ modulo_encargos: true }),
    ]),
  );

  const clientUuid = randomUUID();
  const paradaId = randomUUID();
  const respuesta = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: {
      capturas: [
        {
          client_uuid: clientUuid,
          parada_id: paradaId,
          turno_id: turnoId,
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

  // Centinela 4: rechazos = 0. El 403 del módulo apagado es SOLO de planificación/lectura (§0,
  // §5.5) — el sync de captura es 2xx SIEMPRE.
  expect(respuesta.status()).toBe(200);
  const acuse = (await respuesta.json()).acuses[0] as {
    aceptada: boolean;
    flags: string[];
    config_version_id: string;
  };
  expect(acuse.aceptada, "la regla de oro: CAPTURA jamás rebota, ni con el módulo apagado").toBe(true);
  expect(acuse.flags).toEqual(["modulo_apagado"]);
  // La CONGELADA del turno, no la vigente que se sella después: la prueba real de «snapshot
  // congelado» (§9.2, §4.4).
  expect(acuse.config_version_id, "la captura tiene que juzgarse con la del turno, no con la de ahora").toBe(
    configVersionId,
  );

  expect(await eventosDeTipo(clientUuid, "entrega.pod_capturada")).toBe(1);
  expect(
    await eventosDeTipo(clientUuid, "entrega.modulo_apagado"),
    "el módulo apagado tiene que quedar DICHO con su propio evento",
  ).toBe(1);
  expect(
    await filasEnRevision("entrega.modulo_apagado"),
    "y con una fila en «Por revisar» para que alguien la mire",
  ).toBeGreaterThanOrEqual(1);

  // El replay NO vuelve a degradar: contar dos veces la misma entrega es la forma exacta en que
  // «Por revisar» deja de mirarse (§5.6, §9.3.1). El flag viaja igual en la respuesta.
  const antesDeFilas = await filasEnRevision("entrega.modulo_apagado");
  const replay = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: {
      capturas: [
        {
          client_uuid: clientUuid,
          parada_id: paradaId,
          turno_id: turnoId,
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
  expect(replay.status()).toBe(200);
  const acuseReplay = (await replay.json()).acuses[0] as { repetida: boolean; flags: string[] };
  expect(acuseReplay.repetida).toBe(true);
  expect(acuseReplay.flags).toEqual(["modulo_apagado"]);
  expect(await filasEnRevision("entrega.modulo_apagado")).toBe(antesDeFilas);
});

test("[AC-FPOD-06] módulo encendido en la config congelada del turno: 2xx, sin flag", async ({
  request,
}) => {
  const { turnoId, configVersionId } = await turnoConConfig("KLPD07", { modulo_encargos: true });

  const clientUuid = randomUUID();
  const paradaId = randomUUID();
  const respuesta = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: {
      capturas: [
        {
          client_uuid: clientUuid,
          parada_id: paradaId,
          turno_id: turnoId,
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
  const acuse = (await respuesta.json()).acuses[0] as { flags: string[]; config_version_id: string };
  expect(acuse.flags).toEqual([]);
  expect(acuse.config_version_id).toBe(configVersionId);
  expect(
    await eventosDeTipo(clientUuid, "entrega.modulo_apagado"),
    "una captura sana no tiene que marcar nada — la bandeja «Por revisar» tiende a cero",
  ).toBe(0);
});
