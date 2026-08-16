import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Esqueleto del hito 0 (§9.1). Lo que estos casos ejercen no es una pantalla bonita: es
// que el ARTEFACTO QUE SE DESPLIEGA funcione de punta a punta. El servidor de este e2e es
// `servidor.mjs` sobre un build de producción: el mismo proceso que corre desplegado. Ese camino es el que ya escondió un defecto brutal en la app
// hermana: una app Next responde 200 en toda ruta por SSR aunque `.next/static` no esté donde el
// servidor la busca, así que un healthcheck pasa perfecto mientras la app nunca hidrata y
// ningún botón de ninguna pantalla hace nada. Se ve bien en una captura y está muerta al
// tocarla. Un `curl` no puede detectarlo; un navegador sí.
//
// Alcance declarado, para que nadie lo confunda con más de lo que es: acá no hay flujo de
// terreno todavía. La apertura de turno, la parada y el cierre nacen en los hitos (c) a
// (e) y traen sus propios e2e con presupuesto de toques. Este archivo cubre el shell.

test("el shell se sirve desde el servidor propio y llega es-CL [hito 0]", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es-CL");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FLOTA");
});

// El manifest real [AC-FMIG-09] necesita una SESIÓN del tenant — sin ella `/api/manifiesto`
// da 404, como el resto del ruteo (§5.5 no describe visitante anónimo, describe un módulo
// apagado). Se reutiliza el tenant `contraccion` ya sembrado para este AC (ver
// `contraccion-manifest.spec.ts`, que ya terminó de correr cuando esta suite arranca) con una
// persona PROPIA para no chocar con su fixture, y se sella una config sin `modulo_vehiculos`
// para que el manifest le llegue vacío a la Inicio real.
const T = TENANTS.find((t) => t.slug === "contraccion")!;
const BD = bdDeTenant(T.slug);
const EN_CONTRACCION = `http://${T.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
const SECRETO = secretoNuevo();

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    // Explícito, no `{}`: una feature AUSENTE del snapshot cuenta ENCENDIDA (§5.5 — un módulo
    // nace prendido, "sin configurar" no es lo mismo que "apagado"), así que la única forma de
    // dejar el manifest vacío es apagar `modulo_vehiculos` a mano, igual que hace `sellar` en
    // contraccion-manifest.spec.ts.
    await c.sql("select crear_config_version($1, $2::jsonb)", [
      "fixture del e2e de esqueleto (AC-FMIG-09)",
      JSON.stringify({ modulo_vehiculos: false }),
    ]);
    // "12.345.678-5": el ejemplo canónico del §0 (db/flota/ruts-sinteticos.mjs), compartible —
    // el único otro fixture de este tenant (contraccion-manifest.spec.ts) usa "11.111.111-1".
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ('12.345.678-5', 'Dueña del esqueleto') returning id::text as id",
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

async function sesionDe(page: Page, secreto: string) {
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
  }, secreto);
}

test("la regla de contracción: sin módulos, vacío ACCIONABLE y no un hueco [hito 0]", async ({ page }) => {
  await sesionDe(page, SECRETO);
  await page.goto(EN_CONTRACCION);
  // §5.5: un módulo apagado no deja hueco, candado ni parpadeo. Con el manifest vacío lo
  // que corresponde es el estado vacío de Miga, que dice qué pasa Y qué hacer — no un
  // «no hay datos» que deja al operador sin salida.
  const vacio = page.getByRole("status");
  await expect(vacio).toBeVisible();
  await expect(vacio).toContainText("administrador");
});

test("los estáticos se sirven de verdad: la app hidrata [hito 0]", async ({ page }) => {
  const rotos: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/_next/static/") && r.status() >= 400) rotos.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/", { waitUntil: "networkidle" });
  // Este es el caso que el paso de artefacto servido del gate protege desde el otro lado, y
  // acá se verifica por CONDUCTA: si los estáticos no se sirvieran, aparecerían 404 y la app
  // quedaría sin hidratar aunque toda ruta respondiera 200.
  expect(rotos, `estáticos con error: ${rotos.join(", ")}`).toEqual([]);
});

test("el manifest declara la PWA instalable y en es-CL [hito 0]", async ({ page }) => {
  // §5.7 pide PWA iOS con manifest standalone. El gate axe/Lighthouse completo es de
  // AC-FMIG-11 (hito g); acá se verifica que el archivo se SIRVE, que es lo que puede
  // romperse en silencio sin que ninguna ruta deje de responder 200.
  const respuesta = await page.request.get("/manifest.webmanifest");
  expect(respuesta.status()).toBe(200);
  const manifest = await respuesta.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.lang).toBe("es-CL");
});
