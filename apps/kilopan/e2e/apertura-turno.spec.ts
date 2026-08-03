import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-VEN-05: apertura de turno con fondo inicial, dos toques. La tabla pan.turnos y el
// arqueo por turno ya existen (0018_turnos_cierre_caja.sql); hasta este commit no había
// pantalla que la abriera desde la app — el camino dorado y seguridad-turnos-caja.spec.ts
// abrían el turno por API a propósito (ver sus comentarios), porque esta pantalla era
// Ola 2 (docs/PROMPT_CORRECTIVO.md §5) y todavía no existía.
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
}

// Turno limpio: si un spec anterior dejó uno abierto en la tablet semilla (mismo
// dispositivo que camino-dorado y seguridad-turnos-caja), se cierra sin aserción antes
// de medir "sin turno abierto" — mismo patrón defensivo que anular-venta.spec.ts.
async function cerrarTurnoSiHay(page: Page) {
  await page.request.post("/api/cierre-caja", {
    data: { declarados: [{ medioPago: "efectivo", declaradoClp: 0 }] },
  });
}

test.describe.configure({ mode: "serial" });
// P1 (auditoría 1-ago-2026): IP de prueba propia — mismo motivo que camino-dorado y
// seguridad-turnos-caja (limitador de intentos compartido, AC-SEC-02).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.60" } });

test("AC-VEN-05: sin turno abierto, «Hoy» ofrece abrirlo antes que vender", async ({ page }) => {
  await ingresar(page, "vendedor");
  await cerrarTurnoSiHay(page);
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByText("Falta abrir el turno")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir turno" })).toBeVisible();
  // La pestaña de "Venta mostrador" sigue ahí (no se bloquea el acceso, solo se guía):
  // AC-VEN-02/03 no dependen de un turno abierto.
  await expect(page.getByRole("link", { name: /Venta mostrador/ })).toBeVisible();
});

test("AC-VEN-05: abrir el turno es teclear el fondo y confirmar — dos toques", async ({ page }) => {
  await ingresar(page, "vendedor");
  await cerrarTurnoSiHay(page);
  await page.goto("/inicio");
  await page.getByRole("link", { name: "Abrir turno" }).click();
  await expect(page).toHaveURL(/\/apertura-turno$/);
  await expect(page.getByRole("heading", { name: "Abrir turno" })).toBeVisible();

  // Toque 1: teclear el fondo inicial con el teclado propio (nunca el del sistema).
  await teclear(page, "15000");
  await expect(page.getByText("15000")).toBeVisible();

  // Toque 2: confirmar. Sin pantallas intermedias, sin modal.
  await page.getByRole("button", { name: "Abrir turno" }).click();

  await expect(page.getByText("Turno abierto con $15.000")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: /Vender en el mesón/ })).toBeVisible();

  // El servidor es la fuente de verdad: el turno quedó realmente abierto con ESE fondo.
  const actual = await page.request.get("/api/turnos/actual");
  const { turno } = (await actual.json()) as { turno: { fondo_inicial_clp: number } | null };
  expect(turno?.fondo_inicial_clp).toBe(15000);

  // El índice único de la BD (turnos_uno_abierto_por_dispositivo) es quien de verdad lo
  // impide: un segundo intento de abrir rebota con 409, y la pantalla lo dice sin
  // reventar — mismo dispositivo, mismo día, un vendedor ya lo abrió.
  await page.goto("/apertura-turno");
  await expect(page.getByText("Ya tienes un turno abierto en este equipo")).toBeVisible();

  // Cierra para no ensuciar el estado (un turno abierto por dispositivo) de otros specs
  // que corren contra la misma base sembrada.
  await page.request.post("/api/cierre-caja", {
    data: { declarados: [{ medioPago: "efectivo", declaradoClp: 0 }] },
  });
});
