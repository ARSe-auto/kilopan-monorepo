import { test, expect, type Page } from "@playwright/test";
import { SEMAFORO } from "../../../packages/nucleo-comun/src/constants.ts";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { FLUJO_DIGEST_SEMAFORO } from "../src/dominio/telemetria-semaforo.ts";

// Telemetría del digest del semáforo hacia el §10 [AC-FSEM-14] — spec 05 §5, maestro §10, §4.6.
//
// El AC entero tiene oráculo PRODUCCIÓN (DONE-adopción del §10, dueño humano): lo que se cierra
// con el piloto es la MEDICIÓN. Este archivo prueba la mitad de software sin la cual el piloto no
// tendría nada que medir: que el digest que llega a «Hoy» ATERRIZA de verdad en `client_metric`,
// por el mismo endpoint de sync que ya vacía la cola de POD y de recarga (§4.6) — no que alguien
// mire el número.
//
// Se ejerce el servidor REAL, sin fixturear el aterrizaje (mismo criterio que
// `toques-flujo.spec.ts` desde AC-FPOD-14): el `page.route` de acá solo MIRA el cuerpo y llama a
// `continue()`, así que la fila la escribe `servidor/metricas-sync.ts::aterrizarMetricas`. La
// verificación en BD va por `client_uuid` exacto —el que este test vio salir— y no por un conteo
// global: `ruteo_activo` lo comparten varias suites que también abren «Hoy», y un conteo se
// volvería flaky sin probar nada más.

const SLUG = "ruteo_activo";
const BD = bdDeTenant(SLUG);
const INTERVALO_MS = SEMAFORO.polling_segundos.min * 1000;

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };
type MetricaCruda = { tipo: string; flujo: string; valor_int: number; client_uuid: string; ts: string };

// Índice 37: libre en `ruteo_activo` (30 es de `refresco-digest`, 33/34 del peek, 35 del detalle).
async function enrolarDuena(): Promise<string> {
  const secreto = secretoNuevo();
  const rut = rutDeFixture(37);
  await con(BD, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [rut, "Dueña de la telemetría del digest"],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
       values ('personal', $1, $2, $3, now())`,
      [p!.id, hashDeSecreto(secreto), u!.id],
    );
  });
  return secreto;
}

let SECRETO_DUENA: string;
test.beforeAll(async () => {
  SECRETO_DUENA = await enrolarDuena();
});

/** El secreto en el MISMO IndexedDB que lee `cliente/aparato.ts::pedir()` — sin él la guardia de
 *  AC-FSEM-09 devuelve 404 y no hay digest que medir. */
async function conSesionDeDuena(page: Page) {
  await page.addInitScript((secreto) => {
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
  }, SECRETO_DUENA);
}

/** Espía el lote de telemetría SIN fixturearlo: lee el cuerpo y lo deja pasar al servidor real. */
async function espiarMetricas(page: Page): Promise<MetricaCruda[]> {
  const vistas: MetricaCruda[] = [];
  await page.route("**/api/sync/capturas", async (route) => {
    const crudo = route.request().postData();
    const cuerpo = crudo === null ? {} : (JSON.parse(crudo) as { metricas?: MetricaCruda[] });
    for (const m of cuerpo.metricas ?? []) vistas.push(m);
    await route.continue();
  });
  return vistas;
}

async function filaEnClientMetric(clientUuid: string) {
  const filas = await con(BD, (c: Conexion) =>
    c.sql<{ tipo: string; flujo: string; valor_int: string }>(
      "select tipo::text as tipo, flujo, valor_int::text as valor_int from client_metric where client_uuid = $1::uuid",
      [clientUuid],
    ),
  );
  return filas[0] ?? null;
}

test("[AC-FSEM-14] el digest que llega a «Hoy» aterriza en `client_metric` con el tipo del enum CERRADO del §4.6", async ({
  page,
}) => {
  const emitidas = await espiarMetricas(page);
  await conSesionDeDuena(page);
  await page.goto("/hoy?seed=a");
  await expect(page.getByTestId("tarjeta-hoy").first()).toBeVisible();

  await expect.poll(() => emitidas.length).toBeGreaterThanOrEqual(1);
  const metrica = emitidas[0]!;
  expect(metrica.tipo).toBe("latencia_ms");
  expect(metrica.flujo).toBe(FLUJO_DIGEST_SEMAFORO);
  expect(Number.isInteger(metrica.valor_int)).toBe(true);
  expect(metrica.valor_int).toBeGreaterThanOrEqual(0);

  // La mitad que de verdad importa: la fila EXISTE en la BD. El §10 lee de `client_metric`, no
  // del cuerpo de un POST que el servidor pudo haber ignorado en silencio con su 2xx.
  await expect
    .poll(async () => (await filaEnClientMetric(metrica.client_uuid))?.tipo ?? null)
    .toBe("latencia_ms");
  const fila = await filaEnClientMetric(metrica.client_uuid);
  expect(fila!.flujo).toBe(FLUJO_DIGEST_SEMAFORO);
  expect(Number(fila!.valor_int)).toBe(metrica.valor_int);
});

test("[AC-FSEM-14] el poll de fondo NO emite telemetría; el refresco manual, que sí es una espera de alguien, sí", async ({
  page,
}) => {
  const emitidas = await espiarMetricas(page);
  await conSesionDeDuena(page);
  await page.clock.install();
  await page.goto("/hoy?seed=a");
  await expect.poll(() => emitidas.length).toBe(1);

  // Dos intervalos completos de poll silencioso: el digest se refresca (AC-FSEM-06 lo prueba) y
  // la telemetría NO crece. Sin esta mitad, un turno entero con la pestaña abierta serían
  // cientos de filas de una espera que nadie tuvo.
  await page.clock.fastForward(INTERVALO_MS * 2 + 1000);
  await page.waitForTimeout(300);
  expect(emitidas.length).toBe(1);

  await page.getByTestId("refrescar-ahora").click();
  await expect.poll(() => emitidas.length).toBe(2);
  expect(emitidas[1]!.flujo).toBe(FLUJO_DIGEST_SEMAFORO);
  // Y la segunda también aterriza: dos mediciones, dos filas, `client_uuid` distinto (§0).
  expect(emitidas[1]!.client_uuid).not.toBe(emitidas[0]!.client_uuid);
  await expect
    .poll(async () => (await filaEnClientMetric(emitidas[1]!.client_uuid))?.flujo ?? null)
    .toBe(FLUJO_DIGEST_SEMAFORO);
});
