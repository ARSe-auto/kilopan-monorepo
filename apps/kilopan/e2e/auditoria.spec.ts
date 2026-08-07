import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

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
    await page.goto("/enrolar");
    await page.getByPlaceholder("pin-secreto-en-IndexedDB").fill(datos.dispositivo.secreto);
    await page.getByRole("button", { name: "Enrolar equipo" }).click();
    await page.waitForURL("/ingresar");

    // Login con admin
    await page.getByPlaceholder("12.345.678-5").fill(datos.usuarios.admin.rut);
    await teclear(page, datos.pin);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.waitForURL("/");

    // Navegar al dashboard
    await page.goto("/dashboard");
    await expect(page.getByText("Panel del dueño")).toBeVisible();

    // Verificar que existe la sección de auditoría
    await expect(page.getByText("Auditoría por usuario y dispositivo")).toBeVisible();

    // Verificar que hay selectores de filtro
    await expect(page.getByText("Usuario")).toBeVisible();
    await expect(page.getByText("Dispositivo")).toBeVisible();

    // Verificar que hay tabla de eventos con encabezados
    await expect(page.getByText("Hora")).toBeVisible();
    await expect(page.getByText("Tipo")).toBeVisible();
  });

  test("acepta filtros de usuario y dispositivo", async ({ page }) => {
    // Autenticarse
    await page.goto("/enrolar");
    await page.getByPlaceholder("pin-secreto-en-IndexedDB").fill(datos.dispositivo.secreto);
    await page.getByRole("button", { name: "Enrolar equipo" }).click();
    await page.waitForURL("/ingresar");
    await page.getByPlaceholder("12.345.678-5").fill(datos.usuarios.admin.rut);
    await teclear(page, datos.pin);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.waitForURL("/");

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
