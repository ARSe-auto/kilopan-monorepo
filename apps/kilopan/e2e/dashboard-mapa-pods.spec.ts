import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-DASH-05: mapa estático de pines de PODs del día (Leaflet + OSM, solo dashboard).
// La tarjeta "Entregas del día" muestra un mapa con pines de todos los PODs cerrados hoy.

const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

// IP propia: cada spec aislada del cupo de limitador de intentos
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.50" } });

test("Dashboard: mapa de entregas del día [AC-DASH-05]", async ({ page }) => {
  // Siembra el dispositivo y entra como admin al dashboard
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin.rut, datos.pin);
  await page.goto("/dashboard");

  // AC-DASH-05: valida que la sección del mapa exista
  const mapaSeccion = page.locator("h2:has-text('Entregas del día')");
  await expect(mapaSeccion).toBeVisible();

  // El mapa renderiza dentro de un MapContainer de Leaflet.
  // Leaflet crea marcadores (elementos con clase .leaflet-marker-icon).
  // Si la base de test tiene PODs cerrados hoy, habrá marcadores.
  // Si no hay entregas, debe mostrar "Sin entregas hoy aún".

  const emptyMessage = page.locator("text=/Sin entregas hoy aún/");
  const markers = page.locator(".leaflet-marker-icon");

  // Espera a que Leaflet renderice
  await page.waitForTimeout(1000);

  const markerCount = await markers.count();

  // Si hay entregas del día en la base de test, valida que se muestren
  if (markerCount > 0) {
    // Interactúa con un pin para probar el popup
    await markers.first().click();

    // El popup debe tener contenido del receptor
    const popup = page.locator(".leaflet-popup-content");
    await expect(popup).toBeVisible();

    // El popup debe mostrar peso en kg
    const popupText = await popup.textContent();
    expect(popupText).toMatch(/kg|peso/i);
  } else {
    // Sin entregas: debe mostrar el mensaje
    await expect(emptyMessage).toBeVisible();
  }
});
