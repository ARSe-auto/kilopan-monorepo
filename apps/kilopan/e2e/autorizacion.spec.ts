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

// Tanda 1 de la auditoría: antes de middleware.ts, cualquier pantalla se abría sin
// sesión con solo escribir la URL. Esto prueba el arreglo contra un servidor real,
// no contra la lógica del middleware en aislamiento — es el punto de un e2e.
test.describe("middleware de autorización", () => {
  test("una ruta protegida sin sesión redirige a /ingresar", async ({ page }) => {
    await page.goto("/caja");
    // Con el motivo en la URL (?motivo=sin-sesion): /ingresar lo traduce a una frase
    // en vez de dejar al operador en un login sin ninguna explicación.
    await expect(page).toHaveURL(/\/ingresar\?motivo=sin-sesion$/);
  });

  test("/ingresar es pública y muestra el teclado de PIN", async ({ page }) => {
    await page.goto("/ingresar");
    await expect(page.getByRole("heading", { name: "KiloPan" })).toBeVisible();
    await expect(page.getByPlaceholder("12.345.678-5")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  });
});

// AC-DASH-02: el chequeo de rol en dashboard/page.tsx era real en código
// (`if (usuario.rol !== "admin")`) pero sin e2e que lo confirmara contra un servidor
// real — la auditoría del 2-ago-2026 lo marcó HUECO. Un repartidor con sesión válida
// que visita /dashboard debe ver el bloqueo, nunca la TCK ni el $/km de "Tu flota".
test.describe("rol de /dashboard", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.60" } });

  test("un repartidor no ve el panel del dueño [AC-DASH-02]", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.repartidor!.rut, datos.pin);
    await page.goto("/dashboard");

    await expect(page.getByText("Esta pantalla es solo para administradores.")).toBeVisible();

    // El CLP y el $/km del dueño jamás llegan al teléfono del repartidor
    // (regla de rol, PROMPT_MAESTRO.md §5).
    await expect(page.getByText("TCK · tasa de conciliación de kilos")).toHaveCount(0);
    await expect(page.getByText("Tu flota")).toHaveCount(0);
    await expect(page.getByText(/\$/)).toHaveCount(0);
  });
});
