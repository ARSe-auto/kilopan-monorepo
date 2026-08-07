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
};

// AC-DASH-09: histórico con rango de fechas y exportación CSV de la conciliación diaria
test.describe("dashboard: histórico de conciliación", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.30" } });

  test("muestra la sección con rango de fechas y tabla o estado vacío", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

    await page.goto("/dashboard");
    await expect(page.getByText("Panel del dueño")).toBeVisible();

    await expect(page.getByText("Histórico de conciliación")).toBeVisible();
    await expect(page.getByText("Desde", { exact: true })).toBeVisible();
    await expect(page.getByText("Hasta", { exact: true })).toBeVisible();

    await expect(
      page.getByText("Fecha", { exact: true }).or(page.getByText("Sin conciliación en ese rango de fechas."))
    ).toBeVisible();

    await expect(page.getByRole("link", { name: "Exportar CSV" })).toBeVisible();
  });

  test("la API del histórico exige rol admin y responde CSV con content-disposition", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);
    await page.goto("/dashboard");

    const hoy = new Date().toISOString().slice(0, 10);
    const r = await page.request.get(`/api/conciliacion-historico?desde=${hoy}&hasta=${hoy}&formato=csv`);
    expect(r.ok()).toBeTruthy();
    expect(r.headers()["content-type"]).toContain("text/csv");
    expect(r.headers()["content-disposition"]).toContain("attachment");
    const cuerpo = await r.text();
    expect(cuerpo.split("\n")[0]).toBe(
      "fecha,g_pesados,g_venta,g_pod_ok,g_merma_tipificada,g_merma_recuperada,tck_pct"
    );
  });

  test("la API rechaza fechas fuera de rango sin admin", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.repartidor!.rut, datos.pin);

    const r = await page.request.get("/api/conciliacion-historico?desde=2026-01-01&hasta=2026-01-07");
    expect(r.status()).toBe(403);
  });
});
