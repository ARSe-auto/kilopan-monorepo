import { test, expect } from "@playwright/test";

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
