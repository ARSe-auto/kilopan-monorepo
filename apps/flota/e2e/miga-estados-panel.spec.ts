import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// La escalada única de carga en las pantallas del módulo 08 [AC-FMIG-10] — §5.7: «skeleton
// <50 ms, spinner solo >400 ms». `pod-estados-obligatorios.spec.ts` (AC-FPOD-22) ya prueba
// el mismo patrón sobre la pantalla de POD con su propio temporizador a mano; esta suite
// prueba que las pantallas de ESTE módulo («Funciones») usan la escalada que ahora vive en
// `packages/miga` (`useEscaladaDeCarga`) — no una copia — así que alcanza con UNA pantalla:
// «Funciones» y Terminología comparten exactamente el mismo componente.
//
// La demora se fuerza con `page.route`, no con IndexedDB: `GET /api/gobierno/funciones` es
// un `fetch` común (`cliente/aparato.ts`), así que interceptarlo en la capa de red alcanza
// sin sustituir ninguna API del navegador.

const A = TENANTS.find((t) => t.slug === "miga_estados")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const RUT_DUENA = "12.345.678-5";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien prueba la escalada de Miga') returning id::text as id",
      [RUT_DUENA],
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
  });
});

/** Mismo patrón que el resto de la suite e2e (`vehiculos.spec.ts`, `pod-estados-obligatorios.spec.ts`):
 *  siembra el secreto de sesión en IndexedDB antes de que la página lo lea. */
async function sesionDe(page: Page) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const r = indexedDB.open("flota-aparato", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("claves");
        r.onsuccess = () => {
          const tx = r.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          tx.onsuccess = () => res();
          tx.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO);
}

test("[AC-FMIG-10] skeleton instantáneo, y el aviso de demora recién pasados los 400 ms", async ({ page }) => {
  await sesionDe(page);
  // El GET real se sirve, pero 700 ms tarde: alcanza para observar los tres momentos —
  // skeleton solo, skeleton + aviso, contenido real.
  await page.route("**/api/gobierno/funciones", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((r) => setTimeout(r, 700));
    return route.continue();
  });

  await page.goto(`${EN_A}/panel/funciones`);

  // El skeleton está desde el primer instante.
  await expect(page.getByRole("status", { name: "Cargando" })).toBeVisible();
  // Y el aviso de demora NO está todavía: recién van a haber pasado unos pocos ms.
  await expect(page.getByTestId("aviso-demora-carga")).toHaveCount(0);

  // Pasados los 400 ms sin respuesta, la escalada aparece — con su propio texto.
  await expect(page.getByTestId("aviso-demora-carga")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByTestId("aviso-demora-carga")).toContainText("Sigue cargando");

  // Y cuando la respuesta por fin llega, el contenido real reemplaza al skeleton entero.
  await expect(page.getByTestId("panel-funciones")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status", { name: "Cargando" })).toHaveCount(0);
  await expect(page.getByTestId("aviso-demora-carga")).toHaveCount(0);
});

test("[AC-FMIG-10] una carga normal (rápida) jamás muestra el aviso de demora", async ({ page }) => {
  await sesionDe(page);
  // Sin interceptor: la respuesta local del stack de CI resuelve muy por debajo de los
  // 400 ms, así que el aviso no debería alcanzar a aparecer nunca.
  await page.goto(`${EN_A}/panel/funciones`);

  await expect(page.getByTestId("panel-funciones")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("aviso-demora-carga")).toHaveCount(0);
});
