import { test, expect, type Page } from "@playwright/test";
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
};

async function teclear(page: Page, texto: string) {
  for (const caracter of texto) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
}

// AC-DASH-06: pantalla de auditoría filtrada por usuario y dispositivo
test.describe("dashboard: auditoría de eventos", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.20" } });

  test("muestra la sección de auditoría en el dashboard", async ({ page }) => {
    // Enrolar y autenticarse
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

    // Navegar al dashboard
    await page.goto("/dashboard");
    await expect(page.getByText("Panel del dueño")).toBeVisible();

    // Verificar que existe la sección de auditoría
    await expect(page.getByText("Auditoría por usuario y dispositivo")).toBeVisible();

    // Verificar que hay selectores de filtro
    await expect(page.getByText("Usuario", { exact: true })).toBeVisible();
    await expect(page.getByText("Dispositivo", { exact: true })).toBeVisible();

    // Tabla con encabezados o el estado vacío legítimo de Miga — ambos son pantalla sana
    await expect(
      page.getByText("Hora", { exact: true }).or(page.getByText("Sin eventos."))
    ).toBeVisible();
  });

  test("acepta filtros de usuario y dispositivo", async ({ page }) => {
    // Autenticarse
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

    // Navegar al dashboard
    await page.goto("/dashboard");
    await expect(page.getByText("Auditoría por usuario y dispositivo")).toBeVisible();

    // Cambiar filtro de usuario
    const selects = page.locator("select");
    const selectUsuario = selects.first();
    await selectUsuario.selectOption({ index: 1 });

    // Esperar a que se carguen los datos (hay debounce de 300ms)
    await page.waitForTimeout(400);

    // La tabla debe seguir visible
    await expect(page.getByText("Auditoría por usuario y dispositivo")).toBeVisible();
  });
});
