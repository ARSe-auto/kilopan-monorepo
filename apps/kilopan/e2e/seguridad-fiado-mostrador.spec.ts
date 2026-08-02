import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// P0-3 (auditoría 1-ago-2026 · campaña correctiva, Ola 0): pan.saldo_cliente solo
// sumaba documento_tributario vía pedidos — una venta de mostrador con
// medio_pago='fiado' no genera ninguno de los dos, así que el fiado del mesón nunca
// entraba en el saldo del cliente. api/ventas/route.ts:40 lo comentaba como "usa el
// mismo cliente y el mismo saldo que el fiado mayorista"; nunca fue cierto.
//
// Ataca la ruta real por HTTP, con sesión de verdad (login por pantalla, misma cookie
// para las llamadas directas vía page.request) — no una simulación de la vista SQL.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
  cliente: { id: string; razonSocial: string };
};

async function teclear(page: Page, texto: string) {
  for (const caracter of texto) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
}

async function ingresar(page: Page, rol: keyof typeof datos.usuarios) {
  await page.addInitScript((d) => {
    window.localStorage.setItem("kp_dispositivo", JSON.stringify(d));
  }, datos.dispositivo);
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

async function saldoDe(page: Page, clienteId: string): Promise<number> {
  const r = await page.request.get("/api/clientes");
  expect(r.ok()).toBeTruthy();
  const { clientes } = (await r.json()) as { clientes: { id: string; saldo_pendiente_clp: number }[] };
  return clientes.find((c) => c.id === clienteId)?.saldo_pendiente_clp ?? 0;
}

test.describe.configure({ mode: "serial" });

test("P0-3: una venta fiada del mesón SUMA al saldo del cliente, y saldarla la descuenta", async ({
  page,
}) => {
  const clienteId = datos.cliente.id;
  // Frica: preparar-base.mjs siembra 10 pesajes de 1000g a destino='mostrador' (10.000g
  // de stock real), a diferencia de Marraqueta (solo pedido de reparto, 0 en mesón).
  const productoId = datos.productos.Frica!;

  await ingresar(page, "vendedor");
  const saldoAntes = await saldoDe(page, clienteId);

  const clientUuid = crypto.randomUUID();
  const venta = await page.request.post("/api/ventas", {
    data: {
      clientUuid,
      medioPago: "fiado",
      clienteId,
      lineas: [{ productoId, gramos: 1000 }],
    },
  });
  expect(venta.ok()).toBeTruthy();
  const { id: ventaId, totalClp } = (await venta.json()) as { id: string; totalClp: number };
  expect(totalClp).toBeGreaterThan(0);

  const saldoTrasVender = await saldoDe(page, clienteId);
  // El defecto original: esta resta daba 0, sin importar cuánto se fiara.
  expect(saldoTrasVender - saldoAntes).toBe(totalClp);

  // Saldar exige admin (mismo gate que PATCH /api/facturar).
  await ingresar(page, "admin");
  const saldar = await page.request.patch("/api/ventas", { data: { ventaId } });
  expect(saldar.ok()).toBeTruthy();

  const saldoTrasSaldar = await saldoDe(page, clienteId);
  expect(saldoTrasSaldar - saldoAntes).toBe(0);

  // Saldar dos veces la misma venta rebota — no es un botón para restar de más.
  const segundaVez = await page.request.patch("/api/ventas", { data: { ventaId } });
  expect(segundaVez.status()).toBe(409);
});

test("control: una venta al CONTADO (efectivo) con clienteId no afecta el saldo", async ({ page }) => {
  const clienteId = datos.cliente.id;
  const productoId = datos.productos.Frica!;

  await ingresar(page, "vendedor");
  const saldoAntes = await saldoDe(page, clienteId);

  const venta = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      clienteId,
      lineas: [{ productoId, gramos: 1000 }],
    },
  });
  expect(venta.ok()).toBeTruthy();

  const saldoDespues = await saldoDe(page, clienteId);
  expect(saldoDespues - saldoAntes).toBe(0);
});
