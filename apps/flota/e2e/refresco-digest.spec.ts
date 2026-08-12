import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEMAFORO } from "../../../packages/nucleo-comun/src/constants.ts";

// Refresco degradable del digest [AC-FSEM-06] — spec 05 §2.6, §4.
//
// TRES mitades, porque el AC pide tres conductas de naturaleza distinta:
//
//   (1) El CONTRATO de servidor —ETag estable por seed, 304 sin body con `If-None-Match`— se
//       prueba con HTTP crudo contra `GET /api/semaforo/digest`, mismo patrón que
//       `peek-n1.spec.ts`.
//   (2) La MECÁNICA de polling en el navegador —cada intervalo (constante de
//       `SEMAFORO.polling_segundos`) SOLO con la pestaña visible, cero requests con la pestaña
//       oculta, pull-to-refresh fuerza un GET— se prueba con `page.route` contando pedidos y
//       `page.clock` avanzando el tiempo sin esperar de verdad los 15-30 s reales («test con
//       Page Visibility simulada» que pide el AC).
//   (3) El DEGRADE offline —banner «sin conexión» con contador real de intentos y el último
//       digest marcado con su antigüedad, sin perder las tarjetas ya cargadas— se prueba con
//       `context.setOffline`.
//
// Más un grep de todo el módulo: cero `WebSocket`/`EventSource` — v1 es polling puro (§5.6).

const PUERTO = 3311;
const DOMINIO = "localhost";
const HOST = `ruteo_activo.${DOMINIO}:${PUERTO}`;
const INTERVALO_MS = SEMAFORO.polling_segundos.min * 1000;

type RespuestaDigest = { status: number; cuerpo: string; etag: string | undefined };

function pedirDigest(cabeceras: Record<string, string> = {}): Promise<RespuestaDigest> {
  return new Promise((resolver, rechazar) => {
    const req = pedir(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: "/api/semaforo/digest?seed=a",
        method: "GET",
        headers: { Host: HOST, ...cabeceras },
      },
      (res) => {
        let cuerpo = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (cuerpo += t));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo, etag: res.headers.etag as string | undefined }));
      },
    );
    req.on("error", rechazar);
    req.end();
  });
}

test.describe("contrato de servidor: ETag/304", () => {
  test("[AC-FSEM-06] primer pedido: 200 con ETag y tarjetas; con If-None-Match responde 304 sin body", async () => {
    const primero = await pedirDigest();
    expect(primero.status).toBe(200);
    expect(primero.etag).toBeTruthy();
    const cuerpo = JSON.parse(primero.cuerpo) as { tarjetas: unknown[] };
    expect(cuerpo.tarjetas.length).toBeGreaterThan(0);

    const segundo = await pedirDigest({ "If-None-Match": primero.etag! });
    expect(segundo.status).toBe(304);
    expect(segundo.cuerpo).toBe("");
    expect(segundo.etag).toBe(primero.etag);
  });

  test("[AC-FSEM-06] el mismo seed produce SIEMPRE el mismo ETag entre pedidos frescos (si no, el 304 nunca calzaría)", async () => {
    const a = await pedirDigest();
    const b = await pedirDigest();
    expect(a.etag).toBe(b.etag);
  });

  test("[AC-FSEM-06] un ETag viejo o de otro seed no calza: responde 200 con body de nuevo", async () => {
    const r = await pedirDigest({ "If-None-Match": '"no-es-el-etag-real"' });
    expect(r.status).toBe(200);
    expect(r.cuerpo.length).toBeGreaterThan(0);
  });
});

test.describe("mecánica de refresco en el navegador (Page Visibility simulada)", () => {
  test("[AC-FSEM-06] con la pestaña visible pollea cada intervalo, y «Actualizar» fuerza un GET extra", async ({ page }) => {
    let llamadas = 0;
    await page.route("**/api/semaforo/digest*", async (route) => {
      llamadas++;
      await route.continue();
    });
    await page.clock.install();
    await page.goto("/hoy?seed=a");
    await expect.poll(() => llamadas).toBeGreaterThanOrEqual(1);

    await page.clock.fastForward(INTERVALO_MS + 1000);
    await expect.poll(() => llamadas).toBeGreaterThanOrEqual(2);

    const antesDelBoton = llamadas;
    await page.getByTestId("refrescar-ahora").click();
    await expect.poll(() => llamadas).toBeGreaterThan(antesDelBoton);
  });

  test("[AC-FSEM-06] con la pestaña oculta desde el arranque: 0 requests al digest en el intervalo", async ({ page }) => {
    let llamadas = 0;
    await page.route("**/api/semaforo/digest*", async (route) => {
      llamadas++;
      await route.continue();
    });
    await page.addInitScript(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    });
    await page.clock.install();
    await page.goto("/hoy?seed=a");
    await page.clock.fastForward(INTERVALO_MS * 2 + 1000);
    await page.waitForTimeout(200);
    expect(llamadas).toBe(0);

    // Al volver visible arranca solo: 0 requests no es un cuelgue del polling.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => llamadas).toBeGreaterThanOrEqual(1);
  });
});

test.describe("offline: cero verde fingido", () => {
  test("[AC-FSEM-06] sin conexión: banner con contador REAL de intentos y el último digest marcado con su antigüedad — las tarjetas cargadas no desaparecen", async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await page.goto("/hoy?seed=a");
    await expect(page.getByTestId("tarjeta-hoy").first()).toBeVisible();
    await expect(page.getByTestId("banner-sin-conexion")).toHaveCount(0);

    await context.setOffline(true);
    await page.clock.fastForward(INTERVALO_MS + 1000);
    await expect(page.getByTestId("banner-sin-conexion")).toBeVisible();
    await expect(page.getByTestId("cola-offline")).toHaveText("1");
    await expect(page.getByTestId("antiguedad-digest")).toBeVisible();
    // El digest viejo se MARCA, no se borra: las tarjetas siguen exactamente las mismas.
    await expect(page.getByTestId("tarjeta-hoy")).toHaveCount(SEMAFORO.tarjetas_max);

    // El contador es real: un segundo intento fallido lo sube a 2, no se queda pegado en 1.
    await page.clock.fastForward(INTERVALO_MS + 1000);
    await expect(page.getByTestId("cola-offline")).toHaveText("2");

    await context.setOffline(false);
    await page.clock.fastForward(INTERVALO_MS + 1000);
    await expect(page.getByTestId("banner-sin-conexion")).toHaveCount(0);
  });
});

test("[AC-FSEM-06] grep del módulo: cero WebSocket/EventSource — v1 es polling puro con ETag (§5.6-refresco)", () => {
  const AQUI = import.meta.dirname;
  const carpetas = [join(AQUI, "..", "src", "app", "hoy"), join(AQUI, "..", "src", "app", "api", "semaforo")];

  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(nombre)) archivos.push(ruta);
    }
  };
  for (const carpeta of carpetas) recorrer(carpeta);
  expect(archivos.length).toBeGreaterThan(0);

  for (const archivo of archivos) {
    const texto = readFileSync(archivo, "utf8");
    expect(texto, `${archivo} no debe usar WebSocket`).not.toMatch(/\bWebSocket\b/);
    expect(texto, `${archivo} no debe usar EventSource`).not.toMatch(/\bEventSource\b/);
  }
});
