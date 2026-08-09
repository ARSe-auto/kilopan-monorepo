import { test, expect } from "@playwright/test";

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

test("la regla de contracción: sin módulos, vacío ACCIONABLE y no un hueco [hito 0]", async ({ page }) => {
  await page.goto("/");
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
