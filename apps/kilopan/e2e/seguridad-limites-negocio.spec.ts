import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-SEC-09 (specs/kilopan/08-seguridad-rendimiento.md, Ola 3/4): auditoría de límites
// de negocio validados SOLO en el cliente. El PIN ya estaba cubierto (PIN_VALIDO.test en
// api/usuarios/route.ts) — esto es el resto. Tres huecos reales, ninguno con respaldo de
// servidor hasta este AC:
//   1. pesoValido() (comun/peso.ts) gatea el botón de /vender y /pedidos con un techo de
//      100.000 g, pero /api/ventas y /api/pedidos no lo repetían — un POST directo con
//      sesión válida pasaba cualquier gramaje.
//   2. Ninguna capa topaba la cantidad de líneas de una venta o un pedido.
//   3. "motivo" de anulación de venta, corrección de cierre y salida con bultos
//      pendientes solo exigía no-vacío, sin techo de largo, en tres rutas distintas.
// Cada caso se ataca por HTTP directo, no por la UI (así lo pide el AC): estos son
// límites de SERVIDOR, y un cliente HTTP que se salte la pantalla es exactamente lo que
// hay que rechazar.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
  cliente: { id: string; razonSocial: string };
};

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de login es compartido (AC-SEC-02). .62 está libre
// (ver el resto de los e2e para las ya tomadas).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.62" } });

test("AC-SEC-09: /api/ventas rechaza una línea con más de 100.000 g, el mismo techo que gatea el botón en /vender", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);

  const r = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      lineas: [{ productoId: crypto.randomUUID(), gramos: 100_001 }],
    },
  });
  expect(r.status()).toBe(400);
});

test("AC-SEC-09: /api/ventas rechaza un carro de más de 200 líneas", async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);

  const lineas = Array.from({ length: 201 }, () => ({
    productoId: datos.productos.Frica,
    gramos: 1,
  }));
  const r = await page.request.post("/api/ventas", {
    data: { clientUuid: crypto.randomUUID(), medioPago: "efectivo", lineas },
  });
  expect(r.status()).toBe(400);
});

test("AC-SEC-09: /api/pedidos rechaza una línea con más de 100.000 g, el mismo techo que gatea el botón en /pedidos", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const r = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega: new Date().toISOString().slice(0, 10),
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 100_001 }],
    },
  });
  expect(r.status()).toBe(400);
});

test("AC-SEC-09: /api/pedidos rechaza un pedido de más de 200 líneas", async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const lineas = Array.from({ length: 201 }, () => ({
    productoId: datos.productos.Marraqueta,
    gramosPedidos: 100,
  }));
  const r = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega: new Date().toISOString().slice(0, 10),
      lineas,
    },
  });
  expect(r.status()).toBe(400);
});

test("AC-SEC-09: /api/ventas/anular rechaza un motivo de más de 500 caracteres", async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // El techo de largo se valida ANTES de mirar si la venta existe (mismo orden que la
  // validación de "no vacío" ya probada en anular-venta.spec.ts), así que un ventaId
  // inventado basta.
  const r = await page.request.post("/api/ventas/anular", {
    data: { ventaId: crypto.randomUUID(), motivo: "x".repeat(501) },
  });
  expect(r.status()).toBe(400);
});

test("AC-SEC-09: /api/cierre-caja/corregir rechaza un motivo de más de 500 caracteres", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const r = await page.request.post("/api/cierre-caja/corregir", {
    data: { cierreCajaId: crypto.randomUUID(), declaradoClp: 1000, motivo: "x".repeat(501) },
  });
  expect(r.status()).toBe(400);
});

test("AC-SEC-09: /api/rutas/salir rechaza un motivo de override de más de 500 caracteres", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // El techo de largo se valida ANTES de tocar la BD (para que aplique haya o no
  // pendientes), así que una rutaId inventada basta.
  const r = await page.request.post("/api/rutas/salir", {
    data: { rutaId: crypto.randomUUID(), motivo: "x".repeat(501) },
  });
  expect(r.status()).toBe(400);
});
