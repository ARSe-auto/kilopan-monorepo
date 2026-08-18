import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Privacidad del rastreo (F3→F5, §7.8, §11) [AC-FTEL-01].
//
// LO QUE ESTE ARCHIVO PRUEBA Y EL pgTAP NO PUEDE: que el aviso que el §7.8 exige —el rastreado
// SIEMPRE puede ver que está siendo rastreado— llegue de verdad a la PANTALLA del chofer, sin
// botón para cerrarlo, y que capturar de verdad ocurra SOLO mientras el turno está abierto. El
// invariante de base —que el INSERT con turno cerrado rebote— vive en
// `db/flota/pgtap/0038_posiciones_solo_turno_abierto.sql`.
//
// El permiso de geolocalización se concede con `context.grantPermissions`/`setGeolocation`
// (mismo mecanismo que `pod-foto-gps-degradado.spec.ts`, AC-FPOD-12): es un fix REAL del
// navegador, no un stub de `navigator.geolocation` a mano.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = Object.keys(VALIDOS)[6]!;
const SECRETO = secretoNuevo();
const PATENTE = "RST0001";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien maneja rastreado') returning id::text as id",
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

test("[AC-FTEL-01] con turno abierto: el chofer VE que está rastreado, y captura de verdad", async ({
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

  // El aviso NO ES CONFIGURABLE NI REMOVIBLE (§7.8): se ve, dice desde cuándo, y no hay un
  // botón cerca para apagarlo.
  const aviso = page.getByTestId("rastreo-estado");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(/^En ruta, rastreado desde \d{2}:\d{2}$/);
  await expect(page.getByRole("button", { name: /rastreo/i })).toHaveCount(0);

  // Y no es solo la pantalla diciéndolo: el punto aterrizó de verdad, con el turno abierto.
  const turnoId = await turnoAbiertoDe(PATENTE);
  await expect
    .poll(() => posicionesDelTurno(turnoId), {
      message: "el rastreo dice 'en ruta' pero no capturó ni un punto",
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
});

test("[AC-FTEL-01] al cerrar el turno, el aviso pasa a 'Rastreo apagado' y la captura se detiene", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -33.45, longitude: -70.66 });
  await sesionDe(page);

  const turnoId = await turnoAbiertoDe(PATENTE);
  const capturadasAntes = await posicionesDelTurno(turnoId);

  await page.goto(`${EN_A}/turno/cerrar`);
  await expect(page.getByTestId("pantalla-cierre")).toBeVisible();
  await page.getByTestId("todo-bien-post").click();
  for (const c of "100500") await page.getByRole("button", { name: c, exact: true }).click();
  for (const c of "75") await page.getByRole("button", { name: c, exact: true }).click();
  await page.getByTestId("continuar-lecturas").click();
  await page.getByTestId("enchufado-si").click();
  await expect(page.getByTestId("turno-cerrado")).toBeVisible({ timeout: 15_000 });

  // El texto exacto que el AC pide, literal, y sin botón para removerlo — mismo principio que
  // la pantalla de apertura.
  const aviso = page.getByTestId("rastreo-estado");
  await expect(aviso).toHaveText("Rastreo apagado");
  await expect(page.getByRole("button", { name: /rastreo/i })).toHaveCount(0);

  // Y la BASE lo sostiene: un intento de capturar sobre este turno YA cerrado rebota (0074,
  // AC-FTEL-01), 0 filas — no hace falta esperar un fix real para probarlo, la privacidad no
  // depende de que el navegador haya dejado de mandar.
  let errorDelRebote: { code?: string } | null = null;
  try {
    await con(BD_A, (c: Conexion) =>
      c.sql("insert into posiciones (turno_id, lat, lng) values ($1, -33.45, -70.66)", [turnoId]),
    );
  } catch (e) {
    errorDelRebote = e as { code?: string };
  }
  expect(errorDelRebote, "el INSERT con turno cerrado tenía que rebotar y no rebotó").not.toBeNull();
  expect(errorDelRebote?.code, "el rebote no fue el check_violation del §7.8").toBe("23514");
  expect(
    await posicionesDelTurno(turnoId),
    "una posición aterrizó sobre un turno ya cerrado: la privacidad del §7.8 no se sostuvo",
  ).toBe(capturadasAntes);
});
