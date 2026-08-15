import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Outbox generalizado a la recarga [AC-FPOD-13] — §4.2 (regla de oro), §4.7 (outbox), §4.8
// (dinero invisible), §5.2 F4, §9.3 centinela 10.
//
// LO QUE ESTE AC PIDE Y ACÁ SE VERIFICA:
//
//   1. El cierre de recarga viaja por el MISMO endpoint que el POD (`/api/sync/capturas`, en
//      `recargas` junto a `capturas`) — no un endpoint aparte.
//   2. Offline + replay ⇒ 2xx SIEMPRE, y el acuse (`acuses_recarga`) es lo que saca la captura
//      de la cola del aparato.
//   3. `costo_clp` queda NULL en lo que el chofer manda — el tipo `RecargaCapturaEntrante` ni
//      siquiera lo declara — y lo completa el trigger `costo_de_energia()` (0027) desde
//      `parametros.tarifa_kwh_clp`, en la MISMA transacción.
//   4. Cero campos monetarios en el acuse que vuelve al chofer (centinela 10).
//   5. Replay del outbox (mismo `client_uuid`) ⇒ exactamente UNA fila (centinela 1, idempotencia
//      del §0), reusando `registrar_recarga` de AC-FVEH-08.
//
// Va en la base PROPIA `hechos` —no en `ruteo_activo`, que la mayoría de las suites de POD
// comparte—: esta suite deja HECHOS append-only (`energy_entry`, §7.4) que no se pueden borrar,
// y la suite de alta de vehículos, que necesita la flota vacía, se pondría roja sin haber hecho
// nada. Mismo criterio y mismo tenant que `recargas.spec.ts` (AC-FVEH-08).
const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_HECHOS = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(21);
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };
const TARIFA_DEL_FIXTURE = 150;

let vehiculoId = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien recarga por el outbox del POD') returning id::text as id",
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
    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('POD9001', 'furgón') returning id::text as id",
    );
    vehiculoId = v!.id;
    await c.sql(
      `insert into parametros (tarifa_kwh_clp) values ($1)
       on conflict (unica) do update set tarifa_kwh_clp = excluded.tarifa_kwh_clp`,
      [TARIFA_DEL_FIXTURE],
    );
  });
});

const cerrarPorElOutbox = (
  request: import("@playwright/test").APIRequestContext,
  recargas: Record<string, unknown>[],
) =>
  request.post(`${EN_HECHOS}/api/sync/capturas`, {
    headers: comoChofer,
    data: { recargas },
  });

const filaDe = (clientUuid: string) =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ costo: string | null; tipo: string; wh: string }>(
      "select costo_clp::text as costo, type::text as tipo, wh::text as wh from energy_entry where client_uuid = $1",
      [clientUuid],
    ),
  ).then((r) => r[0] ?? null);

const cuantasConClientUuid = (clientUuid: string) =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from energy_entry where client_uuid = $1", [
      clientUuid,
    ]),
  ).then((r) => Number(r[0]!.n));

test("[AC-FPOD-13] el cierre de recarga viaja por el MISMO outbox: 2xx, costo_clp completado por el trigger, cero monto en el acuse", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const respuesta = await cerrarPorElOutbox(request, [
    {
      client_uuid: clientUuid,
      vehiculo_id: vehiculoId,
      turno_id: null,
      wh: 20_000,
      soc_inicial: 20,
      soc_final: 90,
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  ]);

  expect(respuesta.status()).toBe(200);
  const cuerpo = (await respuesta.json()) as { acuses_recarga: Record<string, unknown>[] };
  const acuse = cuerpo.acuses_recarga[0]!;
  expect(acuse.aceptada, "regla de oro: la recarga jamás rebota (§4.2)").toBe(true);
  // Centinela 10: el acuse que vuelve al chofer no trae, ni puede traer, un monto.
  expect(Object.keys(acuse), "el acuse del chofer no lleva costo").not.toContain("costo_clp");

  const fila = await filaDe(clientUuid);
  expect(fila, "la captura offline tiene que aterrizar en energy_entry").not.toBeNull();
  expect(fila!.tipo, "el cierre de recarga es tipo charge").toBe("charge");
  expect(Number(fila!.wh)).toBe(20_000);
  // El costo NO lo mandó el chofer (no viaja en el cuerpo de arriba) y quedó escrito igual: lo
  // completó `costo_de_energia()` desde la tarifa del tenant, en la MISMA transacción.
  expect(
    Number(fila!.costo),
    "costo_clp lo completa el trigger desde parametros.tarifa_kwh_clp (§4.8)",
  ).toBe((20_000 / 1000) * TARIFA_DEL_FIXTURE);
});

test("[AC-FPOD-13] replay del outbox (mismo client_uuid) deja exactamente UNA fila", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const cuerpo = {
    client_uuid: clientUuid,
    vehiculo_id: vehiculoId,
    turno_id: null,
    wh: 15_000,
    soc_inicial: 30,
    soc_final: 80,
    ts_dispositivo: new Date().toISOString(),
    tz_offset_min: -240,
  };

  const primera = await cerrarPorElOutbox(request, [cuerpo]);
  expect(primera.status()).toBe(200);
  expect(((await primera.json()) as { acuses_recarga: { repetida: boolean }[] }).acuses_recarga[0]!.repetida).toBe(
    false,
  );

  const segunda = await cerrarPorElOutbox(request, [cuerpo]);
  expect(segunda.status()).toBe(200);
  const acuseSegunda = ((await segunda.json()) as { acuses_recarga: { repetida: boolean }[] })
    .acuses_recarga[0]!;
  expect(acuseSegunda.repetida, "el replay-on-startup + replay-on-online no puede duplicar la sesión").toBe(
    true,
  );

  expect(await cuantasConClientUuid(clientUuid), "centinela 1: el replay duplicó la fila").toBe(1);
});

test("[AC-FPOD-13] rechazos = 0: la degradación real no tumba la recarga (centinela 4)", async ({
  request,
}) => {
  const casos = [
    { wh: 1, soc_inicial: 0, soc_final: 100 },
    { wh: 60_000, soc_inicial: null, soc_final: null },
  ];
  let rechazos = 0;
  for (const caso of casos) {
    const r = await cerrarPorElOutbox(request, [
      {
        client_uuid: randomUUID(),
        vehiculo_id: vehiculoId,
        turno_id: null,
        ts_dispositivo: new Date().toISOString(),
        tz_offset_min: -240,
        ...caso,
      },
    ]);
    if (r.status() >= 400) rechazos++;
  }
  expect(rechazos, "el vehículo ya se cargó: negarle la fila no descarga la batería").toBe(0);
});
