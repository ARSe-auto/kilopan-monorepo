import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-DES-05: API de carga sobre 0024 (specs/kilopan/04-despacho-reparto.md) — generar
// bultos al confirmar el pedido, escaneo por HTTP con 409 en duplicado, y el contador
// N/M por ruta que F3 va a leer. La pantalla de escaneo es AC-DES-06 (todavía no existe):
// esto ejercita los tres endpoints directo por HTTP, como Anexo B.
//
// Una sola ruta con DOS pedidos: uno cerrado CON cantidadBultos (nacen 3 bultos) y otro
// cerrado SIN cantidadBultos (compatibilidad: no genera ninguno). El total N/M de la ruta
// es 3 y no 4 — prueba de que el pedido sin cantidad no aporta bultos, igual que todo el
// histórico previo a esta función. Va sobre `repartidorDespacho`, propio del test, porque
// el camino dorado deja a Luis con una ruta activa hoy y la BD no admite dos por repartidor.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
  cliente: { id: string; razonSocial: string };
  repartidorDespacho: { id: string };
};

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.61" } });

test("AC-DES-05: generar bultos al confirmar, escanear (2xx), duplicado (409), 404 y N/M por ruta", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const fechaEntrega = new Date().toISOString().slice(0, 10);

  // Pedido A: confirmar con cantidadBultos dispara pan.generar_bultos() en el mismo commit
  // de asignar_correlativo — un pedido cerrado nace con sus bultos ya numerados.
  const pedidoA = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 5000 }],
      cantidadBultos: 3,
    },
  });
  expect(pedidoA.ok()).toBeTruthy();
  const { id: pedidoAId } = (await pedidoA.json()) as { id: string };

  // Pedido B: confirmado SIN cantidadBultos — no genera bultos (compatibilidad con el
  // histórico previo a la función; el gate de carga de 0024 lo trata con pendientes = 0).
  const pedidoB = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Hallulla, gramosPedidos: 3000 }],
    },
  });
  expect(pedidoB.ok()).toBeTruthy();
  const { id: pedidoBId } = (await pedidoB.json()) as { id: string };

  // Una ruta con los dos pedidos, sobre el repartidor propio del test.
  const ruta = await page.request.post("/api/rutas", {
    data: { repartidorId: datos.repartidorDespacho.id, pedidoIds: [pedidoAId, pedidoBId] },
  });
  expect(ruta.ok()).toBeTruthy();
  const { id: rutaId } = (await ruta.json()) as { id: string };

  // N/M antes de escanear: 3 bultos (solo los de A), 0 cargados. Que sea 3 y no 4 es la
  // prueba de compatibilidad: B, sin cantidadBultos, no aportó ninguno.
  const estadoInicial = await page.request.get(`/api/bultos?rutaId=${rutaId}`);
  expect(estadoInicial.ok()).toBeTruthy();
  const inicial = (await estadoInicial.json()) as {
    bultos: { id: string; codigo: string; correlativo_pedido: string }[];
    cargados: number;
    total: number;
  };
  expect(inicial.total).toBe(3);
  expect(inicial.cargados).toBe(0);
  const codigo = inicial.bultos[0]!.codigo;
  expect(codigo).toMatch(/^P\d+-1$/);

  // Escaneo válido: 2xx.
  const escaneo = await page.request.post("/api/bultos", { data: { codigo } });
  expect(escaneo.ok()).toBeTruthy();
  const cuerpoEscaneo = (await escaneo.json()) as { id: string; codigo: string };
  expect(cuerpoEscaneo.codigo).toBe(codigo);

  // El mismo código otra vez: pan.cargar_bulto() rebota «ya escaneado» → 409.
  const duplicado = await page.request.post("/api/bultos", { data: { codigo } });
  expect(duplicado.status()).toBe(409);
  const cuerpoDuplicado = (await duplicado.json()) as { error: string; motivo: string };
  expect(cuerpoDuplicado.motivo).toBe("duplicado");

  // Un código que no existe → 404, no 409 (son dos rebotes distintos).
  const desconocido = await page.request.post("/api/bultos", { data: { codigo: "P0-999" } });
  expect(desconocido.status()).toBe(404);

  // N/M con carga parcial: 1 de 3.
  const estadoParcial = await page.request.get(`/api/bultos?rutaId=${rutaId}`);
  const parcial = (await estadoParcial.json()) as { cargados: number; total: number };
  expect(parcial.cargados).toBe(1);
  expect(parcial.total).toBe(3);
});
