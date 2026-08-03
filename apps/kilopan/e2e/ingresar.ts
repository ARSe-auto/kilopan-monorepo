import { expect, type Page } from "@playwright/test";

// `teclear` e `ingresar` estaban copiados a mano en cada spec que necesitaba entrar —
// siete copias al 3-ago-2026. Acá viven una sola vez para que un spec nuevo no sume la
// octava. Los siete existentes siguen con su copia a propósito: migrarlos es un cambio
// de siete archivos que no tiene por qué viajar con un arreglo de /ruta, y romperlos
// costaría más de lo que ahorra. Este archivo es el destino cuando alguien los toque.

/** Teclea en el teclado en pantalla, que es el único que existe en estas pantallas. */
export async function teclear(page: Page, texto: string) {
  for (const caracter of texto) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
}

/**
 * Entra con RUT y PIN, como lo hace el operador al llegar.
 *
 * El reintento sobre el campo de RUT no es paranoia: la pantalla precarga el RUT del
 * operador anterior desde localStorage en un efecto POSTERIOR al montaje, así que
 * escribir antes de que corra deja el RUT viejo en el formulario y el turno se abre a
 * nombre de quien se acaba de ir. Reintentar hasta que el valor se quede es lo que hace
 * el operador de verdad —borra y escribe el suyo— y además no depende de cuándo hidrata
 * React.
 */
export async function ingresar(page: Page, rut: string, pin: string) {
  await page.goto("/ingresar");

  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(rut);
    await expect(campoRut).toHaveValue(rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  await teclear(page, pin);
  await page.getByRole("button", { name: "Ingresar" }).click();

  // Esperar a que la URL YA NO sea /ingresar sirve para los cuatro roles a la vez
  // (maestro y repartidor entran directo a su única pantalla; admin y vendedor a «Hoy»),
  // y evita interrumpir con un goto() la navegación que el login todavía tiene en curso.
  await expect(page).not.toHaveURL(/\/ingresar/, { timeout: 10_000 });
  // La tab bar confirma que la pantalla de destino montó de verdad, con sesión y todo.
  await expect(page.getByRole("link").first()).toBeVisible();
}
