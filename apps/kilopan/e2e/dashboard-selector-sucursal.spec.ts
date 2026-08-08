import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  sucursales: {
    centro: { id: string; nombre: string };
    nunoa: { id: string; nombre: string; gramosPesados: number };
  };
};

// AC-SUC-02: selector de sucursal en el dashboard — visible con 2+ sucursales activas
// (la siembra de e2e/preparar-base.mjs crea "Local Centro" y "Local Ñuñoa"), y elegir
// una filtra de verdad la conciliación del día por esa sucursal.
test.describe("dashboard: selector de sucursal", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.31" } });

  test("se ve con dos sucursales activas y ofrece 'todas' más cada una", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

    await page.goto("/dashboard");
    await expect(page.getByText("Panel del dueño")).toBeVisible();

    const selector = page.getByLabel("Sucursal", { exact: true });
    await expect(selector).toBeVisible();
    await expect(selector.locator("option")).toHaveCount(3);
    await expect(selector.locator("option").first()).toHaveText("Todas las sucursales");
    await expect(selector.locator(`option[value="${datos.sucursales.centro.id}"]`)).toHaveText(
      datos.sucursales.centro.nombre
    );
    await expect(selector.locator(`option[value="${datos.sucursales.nunoa.id}"]`)).toHaveText(
      datos.sucursales.nunoa.nombre
    );
  });

  test("elegir una sucursal filtra la conciliación del día a lo pesado en ese local", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

    await page.goto(`/dashboard?sucursal=${datos.sucursales.nunoa.id}`);
    await expect(page.getByText("Panel del dueño")).toBeVisible();

    await expect(page.getByLabel("Sucursal", { exact: true })).toHaveValue(datos.sucursales.nunoa.id);
    // El histórico (AC-DASH-09, misma pantalla) agrega TODOS los pesajes del día sin
    // filtrar por sucursal (31 kg) — "4 kg" es exclusivo de la tarjeta filtrada por
    // Ñuñoa, así que basta para confirmar que el filtro de verdad restringe la cifra.
    await expect(page.getByText("4 kg", { exact: true })).toBeVisible();
  });

  test("un id de sucursal inexistente no rompe la pantalla ni queda como filtro activo", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

    await page.goto("/dashboard?sucursal=00000000-0000-0000-0000-000000000000");
    await expect(page.getByLabel("Sucursal", { exact: true })).toHaveValue("");
  });
});
