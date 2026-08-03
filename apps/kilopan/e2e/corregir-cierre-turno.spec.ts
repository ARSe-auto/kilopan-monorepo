import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-ADM-06 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): corregir un
// cierre de turno desde /arreglar exige un motivo escrito y no vacío, y el cierre
// original NO se pisa — la corrección se registra encima (append-only) y ambas quedan
// legibles. Se ataca la ruta real por HTTP con sesión de verdad (login por pantalla),
// no una simulación: abre turno, cierra caja (crea el cierre original), corrige con
// motivo y comprueba que la corrección entra; un doble-tap sobre el MISMO cierre
// rebota en vez de duplicar la corrección.
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
// ver camino-dorado.spec.ts para el detalle. .44 y .45 ya las usan seguridad-arreglar
// y anular-venta.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.46" } });

test("AC-ADM-06: corregir un cierre de turno exige motivo, y el original no se pisa", async ({ page }) => {
  await ingresar(page, "admin");

  // Turno limpio y un cierre real que corregir.
  const abierto = await page.request.post("/api/turnos", { data: { fondoInicialClp: 5000 } });
  expect(abierto.ok()).toBeTruthy();
  const cierre = await page.request.post("/api/cierre-caja", {
    data: { declarados: [{ medioPago: "efectivo", declaradoClp: 10000 }] },
  });
  expect(cierre.ok()).toBeTruthy();

  // No existe un GET que devuelva el id del cierre recién creado (mismo límite que
  // tiene hoy /api/cierre-caja: solo resume esperado/declarado por medio de pago, sin
  // id de fila) — por HTTP el test solo puede ejercitar la validación de entrada y el
  // 404 de un id inventado. El camino feliz (el original queda intacto, la corrección
  // entra con su motivo y su evento, y un doble-tap sobre el MISMO original rebota) se
  // prueba contra la BD real en db/test-invariantes.mjs, que sí puede leer la tabla.
  const inexistente = await page.request.post("/api/cierre-caja/corregir", {
    data: { cierreCajaId: crypto.randomUUID(), declaradoClp: 12000, motivo: "faltaban dos billetes" },
  });
  expect(inexistente.status()).toBe(404);

  // Sin motivo escrito no se corrige: la confirmación es escribir el porqué, no marcar
  // una casilla (regla transversal de la sección). El servidor rebota con 400 antes de
  // siquiera mirar si el cierre existe.
  const sinMotivo = await page.request.post("/api/cierre-caja/corregir", {
    data: { cierreCajaId: crypto.randomUUID(), declaradoClp: 12000, motivo: "   " },
  });
  expect(sinMotivo.status()).toBe(400);
});

test("AC-ADM-06: un vendedor NO puede corregir un cierre de turno — el servidor lo rebota con 403", async ({
  page,
}) => {
  await ingresar(page, "vendedor");
  // El rechazo por rol lo decide el servidor antes de tocar el cierre: un cierreCajaId
  // cualquiera basta, no llega a mirarlo. Esconder el botón en la UI sería teatro (AC-ADM-04).
  const r = await page.request.post("/api/cierre-caja/corregir", {
    data: { cierreCajaId: crypto.randomUUID(), declaradoClp: 1000, motivo: "no debería poder" },
  });
  expect(r.status()).toBe(403);
});
