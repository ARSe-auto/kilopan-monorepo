import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-DES-06: pantalla F3 `/cargar` — contador N/M 96 px, captura manual + checklist,
// banner ámbar en duplicado, salir-a-ruta con la única modal permitida (motivo + quién).
// e2e móvil 390×844 del camino feliz y del duplicado.
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

test.use({ viewport: { width: 390, height: 844 } });
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.61" } });

test("AC-DES-06: pantalla de carga — contador, captura manual, duplicado y override", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const fechaEntrega = new Date().toISOString().slice(0, 10);

  // Crear un pedido con 3 bultos
  const pedido = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 5000 }],
      cantidadBultos: 3,
    },
  });
  const { id: pedidoId } = (await pedido.json()) as { id: string };

  // Una ruta con ese pedido
  const ruta = await page.request.post("/api/rutas", {
    data: { repartidorId: datos.repartidorDespacho.id, pedidoIds: [pedidoId] },
  });
  const { id: rutaId } = (await ruta.json()) as { id: string };

  // Obtener los códigos de los bultos
  const bultosList = await page.request.get(`/api/bultos?rutaId=${rutaId}`);
  expect(bultosList.ok()).toBeTruthy();
  const bultoData = (await bultosList.json()) as {
    bultos?: { codigo: string; razon_social: string }[];
    cargados?: number;
    total?: number;
  };
  expect(bultoData.bultos).toBeDefined();
  expect(bultoData.bultos).toHaveLength(3);
  const codigo1 = bultoData.bultos![0]!.codigo;
  const codigo2 = bultoData.bultos![1]!.codigo;
  const codigo3 = bultoData.bultos![2]!.codigo;

  // Navegar a la pantalla de carga
  await page.goto(`/cargar?rutaId=${rutaId}`);

  // Verificar que el contador empieza en 0/3
  await expect(page.locator("text=/^0\\/3$/")).toBeVisible();
  await expect(page.locator("text=bultos cargados")).toBeVisible();

  // Verificar que aparece la lista de bultos sin cargar
  await expect(page.locator(`text=${codigo1}`)).toBeVisible();
  await expect(page.locator(`text=${codigo2}`)).toBeVisible();
  await expect(page.locator(`text=${codigo3}`)).toBeVisible();

  // Camino feliz: escanear el primer bulto
  await page.click("button:has-text('Escanear código')");
  // En la pantalla de captura manual, el TecladoNumerico debe ser visible
  await expect(page.locator("text=Ingresa el código del bulto")).toBeVisible();

  // Usar el TecladoNumerico para ingresar el código (es numerico + P y -)
  const inputCodigo = page.locator('input[type="text"]').first(); // El input del TecladoNumerico
  await inputCodigo.click();
  for (const char of codigo1) {
    await page.keyboard.type(char);
  }

  // Click en escanear
  const botonEscanear = page.locator("button:has-text('Escanear')").first();
  await expect(botonEscanear).toBeEnabled();
  await botonEscanear.click();

  // Volver a la lista — el contador debe ser 1/3
  await expect(page.locator("text=/^1\\/3$/")).toBeVisible();
  // El primer bulto debe estar marcado como cargado (checkbox checked y ✓)
  const primeraFila = page.locator("text=" + codigo1).first();
  const checkbox = primeraFila.locator("xpath=preceding::input[@type='checkbox']").first();
  await expect(checkbox).toBeChecked();

  // Escanear el segundo bulto — flujo repetido
  await page.click("button:has-text('Escanear código')");
  const input2 = page.locator('input[type="text"]').first();
  await input2.click();
  for (const char of codigo2) {
    await page.keyboard.type(char);
  }
  await page.locator("button:has-text('Escanear')").first().click();
  await expect(page.locator("text=/^2\\/3$/")).toBeVisible();

  // Repetir el segundo código (duplicado) — debería mostrar banner ámbar
  await page.click("button:has-text('Escanear código')");
  const input3 = page.locator('input[type="text"]').first();
  await input3.click();
  for (const char of codigo2) {
    await page.keyboard.type(char);
  }
  await page.locator("button:has-text('Escanear')").first().click();

  // Banner ámbar de duplicado
  await expect(page.locator(`text=Bulto ya escaneado: ${codigo2}`)).toBeVisible();
  // El contador sigue siendo 2/3 (no se cuenta el duplicado)
  await expect(page.locator("text=/^2\\/3$/")).toBeVisible();

  // Volver a la lista
  await page.click("button:has-text('Volver')");

  // Verificar que todavía hay un bulto sin cargar (el tercero)
  const terceraFila = page.locator("text=" + codigo3).first();
  const checkboxTercera = terceraFila.locator("xpath=preceding::input[@type='checkbox']").first();
  await expect(checkboxTercera).not.toBeChecked();

  // Intentar salir sin cargar el 100% — abre modal
  await page.click("button:has-text(/^Salir a ruta/)");
  await expect(page.locator("text=Salir con bultos pendientes")).toBeVisible();

  // Rellenar el motivo del override
  const textareaMotivo = page.locator("textarea");
  await textareaMotivo.fill("Cliente no estaba disponible para descargar");

  // Confirmar salida
  const botonConfirmar = page.locator("button:has-text('Salir a ruta')").last();
  await botonConfirmar.click();

  // Después de salir, debería redirigirse a /ruta (o similar)
  // Esperar un poco para que ocurra la redirección
  await page.waitForURL(/\/ruta/, { timeout: 5000 });
});

test("AC-DES-06: camino feliz — 100% cargado sin modal", async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const fechaEntrega = new Date().toISOString().slice(0, 10);

  // Crear un pedido con 2 bultos (pequeño)
  const pedido = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 2000 }],
      cantidadBultos: 2,
    },
  });
  const { id: pedidoId } = (await pedido.json()) as { id: string };

  const ruta = await page.request.post("/api/rutas", {
    data: { repartidorId: datos.repartidorDespacho.id, pedidoIds: [pedidoId] },
  });
  const { id: rutaId } = (await ruta.json()) as { id: string };

  const bultosList = await page.request.get(`/api/bultos?rutaId=${rutaId}`);
  expect(bultosList.ok()).toBeTruthy();
  const bultoData = (await bultosList.json()) as {
    bultos?: { codigo: string }[];
  };
  expect(bultoData.bultos).toBeDefined();
  expect(bultoData.bultos).toHaveLength(2);
  const codigo1 = bultoData.bultos![0]!.codigo;
  const codigo2 = bultoData.bultos![1]!.codigo;

  await page.goto(`/cargar?rutaId=${rutaId}`);

  // Escanear ambos bultos
  for (const codigo of [codigo1, codigo2]) {
    await page.click("button:has-text('Escanear código')");
    const input = page.locator('input[type="text"]').first();
    await input.click();
    for (const char of codigo) {
      await page.keyboard.type(char);
    }
    await page.locator("button:has-text('Escanear')").first().click();
  }

  // Contador debe ser 2/2
  await expect(page.locator("text=/^2\\/2$/")).toBeVisible();

  // Botón debe decir "Salir a ruta (100 %)"
  await expect(page.locator("button:has-text('Salir a ruta (100 %)')")).toBeVisible();

  // Salir — NO debe abrir modal
  await page.click("button:has-text('Salir a ruta (100 %)')");

  // No debería haber modal de motivo
  await expect(page.locator("text=Salir con bultos pendientes")).not.toBeVisible();

  // Redirige a /ruta directo
  await page.waitForURL(/\/ruta/, { timeout: 5000 });
});
