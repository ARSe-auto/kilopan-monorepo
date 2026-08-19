import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";
import { RASTREO } from "../../../packages/nucleo-comun/src/constants.ts";

// Torre de control honesta [AC-FTEL-04] — §5.7, §11.
//
// Lo que este archivo prueba y no cubren ni el unit de `antiguedadDePosicion`
// (`dominio/torre-de-control.test.ts`) ni el pgTAP de `posiciones`:
//   1. el CAMINO COMPLETO BD → `/api/torre-de-control` → pantalla — con DOS vehículos y
//      DOS relojes de servidor distintos (`recibida_en`), uno fresco y uno pasado el umbral
//      de 10 min (`RASTREO.umbral_desactualizada_min`), el gestor ve la antigüedad correcta
//      de cada uno y solo el segundo marcado «Desactualizada»;
//   2. que un `capturada_en` (reloj del TELÉFONO) reciente en la fila vieja NO la maquilla —
//      el doble reloj resuelto del lado del servidor, de punta a punta y no solo en la función
//      pura;
//   3. que un vehículo EN RUTA sin ninguna posición capturada todavía degrada honesto: la
//      fila dice «Sin posición aún» y el mapa cae a su estado vacío, en vez de inventar un
//      punto (§5.7: «el mapa degrada, no inventa»).
//
// Tenant `hechos` (mismo que `rastreo.spec.ts`/`rastreo-outbox.spec.ts`, AC-FTEL-01/03): es la
// base dedicada a HECHOS append-only (turnos, posiciones) para no chocar con la flota vacía
// que otras suites dan por sentada. Las aserciones van por `data-testid` de LA PROPIA patente,
// nunca por conteo total de la lista — la base se comparte con esas suites hermanas.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_GESTORA = rutDeFixture(56);
const SECRETO = secretoNuevo();
const PATENTE_FRESCA = "TDC0001";
const PATENTE_VIEJA = "TDC0002";

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

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Gestora de la torre de control') returning id::text as id",
      [RUT_GESTORA],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );

    const [cfg] = await c.sql<{ id: string }>(
      "select crear_config_version($1, $2::jsonb)::text as id",
      ["e2e AC-FTEL-04 — torre de control", JSON.stringify({})],
    );

    for (const patente of [PATENTE_FRESCA, PATENTE_VIEJA]) {
      const [v] = await c.sql<{ id: string }>(
        "insert into vehiculos (patente, tipo) values ($1, 'furgón') returning id::text as id",
        [patente],
      );
      await c.sql("insert into turnos (vehiculo_id, config_version_id) values ($1, $2)", [v!.id, cfg!.id]);
    }
  });
});

test("[AC-FTEL-04] turno abierto sin posición aún: la fila y el mapa degradan honesto, no inventan", async ({
  page,
}) => {
  await sesionDe(page);
  await page.goto(`${EN_A}/torre-de-control`);

  await expect(page.getByTestId("torre-de-control")).toBeVisible();
  await expect(page.getByTestId(`torre-vehiculo-${PATENTE_FRESCA}`)).toBeVisible();
  await expect(page.getByTestId(`torre-sin-posicion-${PATENTE_FRESCA}`)).toHaveText("Sin posición aún");
  await expect(page.getByTestId(`torre-sin-posicion-${PATENTE_VIEJA}`)).toHaveText("Sin posición aún");
  // El mapa (§5.7: «degrada, no inventa») cae a su propio estado vacío — ni un marcador
  // inventado con coordenadas que nadie reportó.
  await expect(page.getByTestId("torre-mapa-vacio")).toBeVisible();
});

test(`[AC-FTEL-04] dos vehículos, dos relojes del servidor: antigüedad honesta y umbral de ${RASTREO.umbral_desactualizada_min} min`, async ({
  page,
}) => {
  // Vehículo fresco: `recibida_en` default (ahora mismo).
  await con(BD_A, (c: Conexion) =>
    c.sql(
      `insert into posiciones (turno_id, lat, lng)
       select t.id, -33.45, -70.66 from turnos t join vehiculos v on v.id = t.vehiculo_id
        where v.patente = $1 and t.estado = 'abierto'`,
      [PATENTE_FRESCA],
    ),
  );

  // Vehículo viejo: el reloj del SERVIDOR (`recibida_en`) dice que aterrizó hace 20 min —bien
  // pasado el umbral de 10— pero el reloj del TELÉFONO (`capturada_en`) dice «ahora mismo».
  // Si la torre de control se dejara maquillar por el reloj del aparato, este vehículo saldría
  // «hace instantes» en vez de «hace 20 min» y «Desactualizada» — exactamente lo que el doble
  // reloj del §4.6 existe para impedir.
  await con(BD_A, (c: Conexion) =>
    c.sql(
      `insert into posiciones (turno_id, lat, lng, capturada_en, recibida_en, tz_offset_min)
       select t.id, -33.47, -70.64, now(), now() - interval '20 minutes', -240
         from turnos t join vehiculos v on v.id = t.vehiculo_id
        where v.patente = $1 and t.estado = 'abierto'`,
      [PATENTE_VIEJA],
    ),
  );

  await sesionDe(page);
  await page.goto(`${EN_A}/torre-de-control`);

  await expect(page.getByTestId("torre-de-control")).toBeVisible();

  const filaFresca = page.getByTestId(`torre-antiguedad-${PATENTE_FRESCA}`);
  await expect(filaFresca).toHaveText("hace instantes");
  await expect(page.getByTestId(`torre-desactualizada-${PATENTE_FRESCA}`)).toHaveCount(0);

  const filaVieja = page.getByTestId(`torre-antiguedad-${PATENTE_VIEJA}`);
  await expect(filaVieja).toContainText("hace 20 min");
  await expect(page.getByTestId(`torre-desactualizada-${PATENTE_VIEJA}`)).toBeVisible();

  // Y el mapa ya no degrada: al menos una posición real que dibujar.
  await expect(page.getByTestId("torre-mapa")).toBeVisible();
  await expect(page.getByTestId("torre-mapa-vacio")).toHaveCount(0);
});

test("[AC-FTEL-04] sin sesión, la torre de control de otro tenant no existe: 404 pelado", async ({ request }) => {
  const r = await request.get(`${EN_A}/api/torre-de-control`);
  expect(r.status()).toBe(404);
});
