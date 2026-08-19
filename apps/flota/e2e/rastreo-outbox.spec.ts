import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// La posición viaja por el MISMO motor de sync [AC-FTEL-03] — §4.6.
//
// Lo que este archivo prueba y las suites hermanas (`rastreo.spec.ts` de AC-FTEL-01, el pgTAP de
// AC-FTEL-02) no cubren:
//   1. offline→online DE VERDAD, con `context.setOffline` y GPS real, y la cola que se vacía sola
//      —«se cuenta en la BD, no en la pantalla» (mismo criterio que `pod-offline.spec.ts`)—;
//   2. un lote MIXTO —`posiciones` + `metricas` en el MISMO POST— entra 2xx para las dos: «lote
//      con posiciones + otros hechos entra 2xx, offline-first sin canal aparte» es exactamente
//      eso, nunca dos POST donde cabe uno;
//   3. el replay del outbox (mismo `client_uuid`) deja EXACTAMENTE una fila a través del
//      ENDPOINT real — el pgTAP de AC-FTEL-02 ya prueba la invariante en la base; esto prueba que
//      el endpoint de sync la respeta.
//
// `workers: 1` / `fullyParallel: false` (playwright.config.ts): los tests de este archivo corren
// en orden, y el segundo y tercero reusan el `turnoId` que abre el primero — mismo turno real,
// mismo criterio que evita inventar un `config_version_id` a mano solo para un fixture de API.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(55);
const SECRETO = secretoNuevo();
const PATENTE = "RST0002";
const comoChofer = { Authorization: `Portador ${SECRETO}` };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien rastrea por el outbox') returning id::text as id",
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
    await c.sql("insert into vehiculos (patente, tipo) values ($1, 'furgón')", [PATENTE]);
  });
});

async function sesionDe(page: Page) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onupgradeneeded = () => p.result.createObjectStore("claves");
        p.onsuccess = () => {
          const req = p.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          req.onsuccess = () => res();
          req.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO);
}

const posicionesDelTurno = (turnoId: string) =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from posiciones where turno_id = $1", [turnoId]),
  ).then((r) => Number(r[0]!.n));

const turnoAbiertoDe = (patente: string) =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      `select t.id::text as id from turnos t join vehiculos v on v.id = t.vehiculo_id
        where v.patente = $1 and t.estado = 'abierto' order by t.abierto_en desc limit 1`,
      [patente],
    ),
  ).then((r) => r[0]!.id);

let turnoId = "";

test("[AC-FTEL-03] sin red la posición se encola, y al volver la señal el replay la aterriza sola", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -33.45, longitude: -70.66 });
  await sesionDe(page);

  await page.goto(`${EN_A}/turno/abrir`);
  await page.getByTestId(`vehiculo-${PATENTE}`).click();
  await page.getByTestId("todo-bien").click();
  for (const c of "100000") await page.getByRole("button", { name: c, exact: true }).click();
  await page.getByTestId("continuar-odometro").click();
  for (const c of "80") await page.getByRole("button", { name: c, exact: true }).click();
  await page.getByTestId("continuar-carga").click();
  await page.getByTestId("abrir-turno").click();
  await expect(page.getByTestId("turno-abierto")).toBeVisible({ timeout: 15_000 });

  turnoId = await turnoAbiertoDe(PATENTE);
  // Con señal, el primer fix ya aterrizó (AC-FTEL-01) — la línea de base de este test es offline.
  await expect.poll(() => posicionesDelTurno(turnoId), { timeout: 10_000 }).toBeGreaterThan(0);
  const antesDeCortar = await posicionesDelTurno(turnoId);

  await page.context().setOffline(true);
  // Un fix nuevo, sin red: el outbox lo encola en localStorage — no hay POST que vuelva.
  await context.setGeolocation({ latitude: -33.46, longitude: -70.65 });
  await page.waitForTimeout(500);
  expect(
    await posicionesDelTurno(turnoId),
    "sin señal no aterrizó nada, que es el punto (§4.6)",
  ).toBe(antesDeCortar);
  // El §5.7 pide el contador REAL de la cola, no silencio — gate-capturas-sin-rechazo.mjs.
  await expect(page.getByTestId("rastreo-por-sincronizar")).toBeVisible();
  await expect(page.getByTestId("contador-cola-rastreo")).toHaveText("1");

  // Vuelve la señal. NADIE toca la pantalla: el replay-on-online del §4.7 es el camino principal.
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect
    .poll(() => posicionesDelTurno(turnoId), {
      message: "volvió la señal pero el punto encolado nunca aterrizó",
      timeout: 15_000,
    })
    .toBeGreaterThan(antesDeCortar);
});

test("[AC-FTEL-03] un lote MIXTO —posiciones + metricas— entra 2xx para las dos, y el replay del mismo client_uuid deja UNA fila", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const respuesta = await request.post(`${EN_A}/api/sync/capturas`, {
    headers: comoChofer,
    data: {
      posiciones: [
        {
          client_uuid: clientUuid,
          turno_id: turnoId,
          lat: -33.47,
          lng: -70.64,
          precision_m: 8,
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -240,
        },
      ],
      metricas: [
        {
          client_uuid: randomUUID(),
          tipo: "sync_error",
          flujo: null,
          valor_int: 0,
          ts: new Date().toISOString(),
          tz_offset_min: -240,
        },
      ],
    },
  });
  expect(respuesta.status()).toBe(200);
  const cuerpo = (await respuesta.json()) as {
    acuses_posiciones: { client_uuid: string; aceptada: boolean; repetida: boolean }[];
    acuses_metricas: { aceptada: boolean }[];
  };
  expect(cuerpo.acuses_posiciones[0]!.aceptada, "regla de oro: la posición jamás rebota (§4.2)").toBe(true);
  expect(cuerpo.acuses_posiciones[0]!.repetida).toBe(false);
  expect(cuerpo.acuses_metricas[0]!.aceptada, "el mismo POST también aterriza la métrica").toBe(true);

  const antes = await posicionesDelTurno(turnoId);
  expect(antes).toBeGreaterThan(0);

  // El replay del MISMO client_uuid deja exactamente una fila (centinela 1, §9.3.1) — a través
  // del endpoint, no solo de la base.
  const repetido = await request.post(`${EN_A}/api/sync/capturas`, {
    headers: comoChofer,
    data: {
      posiciones: [
        {
          client_uuid: clientUuid,
          turno_id: turnoId,
          lat: -33.47,
          lng: -70.64,
          precision_m: 8,
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -240,
        },
      ],
    },
  });
  expect(repetido.status()).toBe(200);
  const cuerpoRepetido = (await repetido.json()) as { acuses_posiciones: { repetida: boolean }[] };
  expect(cuerpoRepetido.acuses_posiciones[0]!.repetida, "el replay duplicó la fila").toBe(true);
  expect(await posicionesDelTurno(turnoId), "centinela 1: el replay duplicó la fila").toBe(antes);
});
