import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-ADM-05 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): anular una venta
// desde /arreglar exige un motivo escrito y no vacío, y la venta anulada DEJA DE SUMAR al
// arqueo de su turno. Se ataca la ruta real por HTTP con sesión de verdad (login por
// pantalla), no una simulación: vende dos, mira el esperado del cierre, anula una con
// motivo y comprueba que el esperado bajó EXACTAMENTE lo anulado. Es la afirmación central
// del AC —"deja de sumar al arqueo"— la que este test hace falsa con el código viejo (sin
// el `where anulada_at is null` en /api/cierre-caja).
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
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

async function vender(page: Page, gramos: number) {
  const r = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      lineas: [{ productoId: datos.productos.Frica, gramos }],
    },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { id: string; totalClp: number };
}

async function esperadoEfectivo(page: Page): Promise<number> {
  const r = await page.request.get("/api/cierre-caja");
  expect(r.ok()).toBeTruthy();
  // El admin (dueño) recibe el esperado; a quien vende se le manda a ciegas (aCiegas).
  const cuerpo = (await r.json()) as {
    medios: { medio_pago: string; esperado_clp?: string }[];
  };
  const fila = cuerpo.medios.find((m) => m.medio_pago === "efectivo");
  return Number(fila?.esperado_clp ?? 0);
}

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02) —
// ver camino-dorado.spec.ts para el detalle.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.45" } });

test("AC-ADM-05: anular una venta la saca del arqueo del turno, y exige motivo escrito", async ({
  page,
}) => {
  // El admin es dueño de /arreglar y puede vender: se usa una sola sesión para todo el
  // flujo (cada login de más reabre la carrera cookie/RSC documentada en BITACORA).
  await ingresar(page, "admin");

  // Turno limpio: si un spec anterior dejó uno abierto en la tablet semilla, se cierra
  // (declarado 0, sin aserción) para que el esperado que se mide sea SOLO de este turno.
  await page.request.post("/api/cierre-caja", {
    data: { declarados: [{ medioPago: "efectivo", declaradoClp: 0 }] },
  });
  const abierto = await page.request.post("/api/turnos", { data: { fondoInicialClp: 5000 } });
  expect(abierto.ok()).toBeTruthy();

  const ventaA = await vender(page, 200);
  const ventaB = await vender(page, 300);
  expect(await esperadoEfectivo(page)).toBe(ventaA.totalClp + ventaB.totalClp);

  // Sin motivo escrito no se anula: la confirmación es escribir el porqué, no marcar una
  // casilla (regla transversal de la sección). El servidor rebota con 400.
  const sinMotivo = await page.request.post("/api/ventas/anular", {
    data: { ventaId: ventaA.id, motivo: "   " },
  });
  expect(sinMotivo.status()).toBe(400);
  // Y el esperado no se movió: un intento fallido no anula nada.
  expect(await esperadoEfectivo(page)).toBe(ventaA.totalClp + ventaB.totalClp);

  // Con motivo, la anulación entra.
  const anular = await page.request.post("/api/ventas/anular", {
    data: { ventaId: ventaA.id, motivo: "El cliente devolvió el pan al toque" },
  });
  expect(anular.ok()).toBeTruthy();

  // Afirmación central del AC: la venta anulada DEJÓ DE SUMAR al arqueo — queda solo B.
  expect(await esperadoEfectivo(page)).toBe(ventaB.totalClp);

  // Doble-tap: anular otra vez la misma venta no vuelve a descontar ni duplica su evento.
  const otraVez = await page.request.post("/api/ventas/anular", {
    data: { ventaId: ventaA.id, motivo: "otra vez" },
  });
  expect(otraVez.status()).toBe(409);
  expect(await esperadoEfectivo(page)).toBe(ventaB.totalClp);

  await page.request.post("/api/cierre-caja", {
    data: { declarados: [{ medioPago: "efectivo", declaradoClp: ventaB.totalClp }] },
  });
});

test("AC-ADM-05: un vendedor NO puede anular una venta — el servidor lo rebota con 403", async ({
  page,
}) => {
  await ingresar(page, "vendedor");
  // El rechazo por rol lo decide el servidor antes de tocar la venta: un ventaId cualquiera
  // basta, no llega a mirarlo. Esconder el botón en la UI sería teatro (AC-ADM-04).
  const r = await page.request.post("/api/ventas/anular", {
    data: { ventaId: crypto.randomUUID(), motivo: "no debería poder" },
  });
  expect(r.status()).toBe(403);
});
