import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-PES-07 (§5 F1): "repetir producto: 2 toques" solo es cierto si el producto que se
// repite está arriba de la grilla. Antes de este AC, /pesar ordenaba `p.nombre` — el
// producto que el maestro pesa todos los días podía terminar al fondo de la lista.
// e2e/preparar-base.mjs siembra pesajes reales: Frica (10) y Hallulla (5), el resto sin
// sembrar (0). Si la grilla siguiera siendo alfabética, Dobladitas (0 pesajes) saldría
// ANTES que Frica y Hallulla — exactamente lo que este test rechaza.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test("la grilla de /pesar ordena por frecuencia real de pesaje, no alfabético", async ({ page }) => {
  await page.addInitScript((d) => {
    window.localStorage.setItem("kp_dispositivo", JSON.stringify(d));
  }, datos.dispositivo);

  await page.goto("/ingresar");
  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(datos.usuarios.maestro!.rut);
    await expect(campoRut).toHaveValue(datos.usuarios.maestro!.rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  for (const caracter of datos.pin) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
  await page.getByRole("button", { name: "Ingresar" }).click();
  // El maestro tiene una sola pantalla y entra DIRECTO a ella (destinoDeIngreso en
  // navegacion.ts): pasar por "Hoy" para elegir entre una única opción no decide nada.
  await expect(page).toHaveURL(/\/pesar$/);

  const nombresConocidos = ["Marraqueta", "Hallulla", "Frica", "Dobladitas", "Integral"];
  await expect
    .poll(async () => (await page.getByRole("button").allTextContents()).filter((n) => nombresConocidos.includes(n)))
    .toContain("Frica");
  const orden = (await page.getByRole("button").allTextContents()).filter((n) =>
    nombresConocidos.includes(n)
  );

  // Frica (10 pesajes) y Hallulla (5) tienen que ir antes que Dobladitas (0 sembrados):
  // orden alfabético las pondría todas al revés (Dobladitas antes que Frica y Hallulla).
  expect(orden.indexOf("Frica")).toBeLessThan(orden.indexOf("Dobladitas"));
  expect(orden.indexOf("Hallulla")).toBeLessThan(orden.indexOf("Dobladitas"));
  // Entre los dos sembrados, el más pesado va primero: no alcanza con "tiene pesajes",
  // el orden respeta la frecuencia real.
  expect(orden.indexOf("Frica")).toBeLessThan(orden.indexOf("Hallulla"));
});
