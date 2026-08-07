import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-POD-05: el flujo de rechazo/parcial desde `/ruta` y la validación del catálogo
// CERRADO de motivos en el servidor. Hueco confirmado por la auditoría del 2-ago-2026
// (Anexo D de specs/kilopan/05-entrega-pod.md): ningún test tocaba ni el flujo de rechazo
// desde `/ruta`, ni el texto «Entregada parcial — X de Y», ni la validación del catálogo
// —`api/sync` solo miraba `!!motivoRechazo`, así que cualquier string colaba como motivo.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  repartidorPod05: {
    rut: string;
    cliente: string;
    paradas: { pedidoId: string; orden: number; gramos: number }[];
  };
};

// IP propia por archivo: el limitador de intentos por IP (20/min, AC-SEC-02) es
// compartido, y sin esto el suite completo lo agota antes de este spec y el login rebota
// con 429 — mismo hallazgo, y misma cura, que camino-dorado.spec.ts.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.55" } });

// Serie: los dos casos entran con el MISMO repartidor sembrado y su única ruta del día;
// en paralelo se pisarían la sesión.
test.describe.configure({ mode: "serial" });

/** Teclea en el teclado en pantalla, único que existe en estas pantallas. */
async function teclear(page: Page, texto: string) {
  for (const caracter of texto) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
});

test("entrega parcial y luego rechazo con motivo de catálogo, desde /ruta", async ({ page }) => {
  await ingresar(page, datos.repartidorPod05.rut, datos.pin);
  // El repartidor entra DIRECTO a su ruta (destinoDeIngreso), igual que Luis.
  await expect(page).toHaveURL(/\/ruta$/);
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();
  await expect(page.getByText(datos.repartidorPod05.cliente).first()).toBeVisible({ timeout: 15_000 });

  // --- Entrega PARCIAL: parada 1 pide 20 kg; se entregan 8 kg ---
  await page.getByRole("button", { name: "Entregar" }).first().click();
  await page.getByRole("button", { name: "Tomar foto" }).click();
  // El campo viene precargado con el total del pedido; "Editar" lo limpia (el teclado
  // APENDE) y recién ahí se teclea lo realmente entregado.
  await page.getByRole("button", { name: "Editar" }).click();
  await teclear(page, "8");
  await page.getByRole("button", { name: "Listo" }).click();
  await page.getByRole("button", { name: "Confirmar entrega" }).click();
  // El texto EXACTO que el AC nombra: «Entregada parcial — X de Y».
  await expect(
    page.getByText(`Entregada parcial — ${datos.repartidorPod05.cliente}: 8 kg de 20 kg`)
  ).toBeVisible({ timeout: 20_000 });

  // La parada 1 sale de la lista (optimista) y la 2 queda activa con su botón "Entregar".
  // --- RECHAZO total: parada 2, motivo del catálogo cerrado ---
  await page.getByRole("button", { name: "Entregar" }).first().click();
  await page.getByRole("button", { name: "Tomar foto" }).click();
  await page.getByRole("button", { name: "No se pudo entregar" }).click();
  // El único motivo que el texto del AC nombra explícitamente. Es un role="radio"
  // (SelectorUnToque); el nombre accesible es la etiqueta mientras no esté activo.
  await page.getByRole("radio", { name: "Cliente rechazó el pedido" }).click();
  await page.getByRole("button", { name: "Confirmar: no se pudo entregar" }).click();
  await expect(
    page.getByText(`No se pudo entregar — ${datos.repartidorPod05.cliente}: Cliente rechazó el pedido`)
  ).toBeVisible({ timeout: 20_000 });
});

test("el servidor rechaza un motivo fuera del catálogo y acepta uno válido", async ({ page }) => {
  // Con la sesión del repartidor (page.request comparte sus cookies), no un fixture pelado
  // que daría 401. Es la misma cola que usa la app: `POST /api/sync`.
  await ingresar(page, datos.repartidorPod05.rut, datos.pin);
  const parada = datos.repartidorPod05.paradas.find((p) => p.orden === 3)!;

  const base = {
    pedidoId: parada.pedidoId,
    receptorNombre: "No aplica — entrega no realizada",
    fotoSha256: "a".repeat(64),
    // Fallida: sin GPS a propósito (migración 0015), 0 g entregados.
    lat: null,
    lng: null,
    precisionM: null,
    gramosEntregados: 0,
    capturadoAt: new Date().toISOString(),
  };

  // Un código inventado, que NO está en pod/motivosRechazo.ts: antes colaba porque el
  // servidor solo miraba `!!motivoRechazo`. Ahora rebota como rechazo explícito.
  const uuidInventado = "aaaaaaaa-0005-4005-8005-000000000001";
  const rInventado = await page.request.post("/api/sync", {
    data: {
      entregas: [{ ...base, clientUuid: uuidInventado, motivoCodigo: "me-lo-invente", motivoRechazo: "cualquier cosa" }],
    },
  });
  expect(rInventado.ok()).toBeTruthy();
  const bInventado = await rInventado.json();
  expect(bInventado.aceptadas).not.toContain(uuidInventado);
  const rzInventado = bInventado.rechazadas.find((x: { clientUuid: string }) => x.clientUuid === uuidInventado);
  expect(rzInventado?.motivo).toMatch(/catálogo/i);

  // "otro" es la única puerta a texto libre, pero exige que el texto exista.
  const uuidOtroVacio = "aaaaaaaa-0005-4005-8005-000000000002";
  const rOtroVacio = await page.request.post("/api/sync", {
    data: { entregas: [{ ...base, clientUuid: uuidOtroVacio, motivoCodigo: "otro", motivoRechazo: "   " }] },
  });
  const bOtroVacio = await rOtroVacio.json();
  const rzOtroVacio = bOtroVacio.rechazadas.find((x: { clientUuid: string }) => x.clientUuid === uuidOtroVacio);
  expect(rzOtroVacio?.motivo).toMatch(/describir/i);

  // Un código VÁLIDO del catálogo: aceptado, y la parada queda registrada como fallida.
  const uuidValido = "aaaaaaaa-0005-4005-8005-000000000003";
  const rValido = await page.request.post("/api/sync", {
    data: { entregas: [{ ...base, clientUuid: uuidValido, motivoCodigo: "rechazo" }] },
  });
  const bValido = await rValido.json();
  expect(bValido.aceptadas).toContain(uuidValido);
});
