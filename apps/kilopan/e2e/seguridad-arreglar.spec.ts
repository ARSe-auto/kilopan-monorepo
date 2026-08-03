import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-ADM-04: la pantalla `/arreglar` es SOLO rol admin, y el rechazo lo decide el
// SERVIDOR con HTTP 403 — no un enlace escondido en el cliente (misma lección que
// `pesaje_foto_obligatoria`: la exigencia se valida en el servidor o no existe).
//
// Se ataca la ruta real por HTTP con sesión de verdad (login por pantalla, misma cookie
// para el GET directo vía page.request), no una simulación. Un repartidor logueado que
// escribe la URL a mano tiene que rebotar con 403; el admin la abre y ve sus seis
// acciones listadas.
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

async function ingresar(page: Page, rol: keyof typeof datos.usuarios) {
  await sembrarDispositivo(page, datos.dispositivo);
  await page.goto("/ingresar");
  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(datos.usuarios[rol]!.rut);
    await expect(campoRut).toHaveValue(datos.usuarios[rol]!.rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await teclear(page, datos.pin);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/ingresar/, { timeout: 10_000 });
  await expect(page.getByRole("link").first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02) —
// ver camino-dorado.spec.ts para el detalle.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.44" } });

test("AC-ADM-04: un repartidor logueado que pide /arreglar rebota con 403 del servidor", async ({
  page,
}) => {
  await ingresar(page, "repartidor");
  // page.request comparte la cookie de sesión del contexto: es el MISMO repartidor,
  // con sesión viva, escribiendo la URL a mano. El servidor —no el menú— la rechaza.
  const r = await page.request.get("/arreglar");
  expect(r.status()).toBe(403);
});

test("AC-ADM-04: un vendedor logueado tampoco entra a /arreglar (403)", async ({ page }) => {
  await ingresar(page, "vendedor");
  const r = await page.request.get("/arreglar");
  expect(r.status()).toBe(403);
});

test("AC-ADM-04: el admin abre /arreglar (200) y ve sus seis acciones listadas", async ({ page }) => {
  await ingresar(page, "admin");
  const r = await page.request.get("/arreglar");
  expect(r.status()).toBe(200);

  await page.goto("/arreglar");
  await expect(page.getByRole("heading", { name: "Arreglar" })).toBeVisible();
  for (const titulo of [
    "Anular una venta",
    "Corregir un cierre de turno",
    "Cerrar una ruta con odómetro",
    "Revocar un equipo enrolado",
    "Desbloquear un PIN",
    "Quitar un pedido de una ruta",
  ]) {
    await expect(page.getByText(titulo, { exact: true })).toBeVisible();
  }
});
