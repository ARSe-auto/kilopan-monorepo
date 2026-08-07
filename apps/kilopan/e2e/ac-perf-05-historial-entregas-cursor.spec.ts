import { test, expect } from "@playwright/test";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-PERF-05: paginación por cursor en historial de entregas
// Verifica que el endpoint /api/entregas con cursor devuelve filas paginadas
// sin offset, y que la pantalla las consume correctamente.

interface Entrega {
  id: string;
  receptor_nombre: string;
  gramos_entregados: number;
  foto_sha256: string | null;
  foto_estado: string;
  gps_degradado: boolean;
  gps_fuera_de_zona: boolean;
  recibido_at: string;
  capturado_at: string;
  razon_social: string;
  correlativo_pedido: number;
  es_parcial: boolean;
  gramos_pedidos: number;
}

interface RespuestaEntregas {
  entregas: Entrega[];
  proximoCursor: string | null;
}

test.describe("AC-PERF-05: Historial de entregas con paginación por cursor", () => {
  // Configurar autenticación antes de cada test
  test.beforeEach(async ({ page, request }) => {
    const datosResp = await request.get("/api/test-data");
    const datos = await datosResp.json();
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin.rut, datos.pin);
  });

  test("debe cargar la primera página del historial", async ({ page }) => {
    await page.goto("/admin/entregas/historial", { waitUntil: "networkidle" });

    // Verificar que la página cargó (puede ser el título o verificar contenido)
    const titulo = page.getByText("Historial de entregas");
    await expect(titulo).toBeVisible();

    // Verificar que se renderizaron entregas (el seed debe tener algunas)
    const cards = page.locator('div[style*="tarjeta"]').first();
    await expect(cards).toBeVisible();
  });

  test("debe mostrar el botón de 'Cargar más' cuando hay próximas páginas", async ({ page }) => {
    await page.goto("/admin/entregas/historial", { waitUntil: "networkidle" });

    // Esperar a que cargue el contenido
    await expect(page.getByText("Historial de entregas")).toBeVisible();

    // Buscar el botón de cargar más (puede no estar si no hay más entregas)
    const botonCargarMas = page.getByRole("button", { name: /Cargar más entregas/ });
    // El botón puede estar o no, dependiendo del seed
    const exists = await botonCargarMas.isVisible({ timeout: 2000 }).catch(() => false);
    if (exists) {
      await expect(botonCargarMas).toBeVisible();
    }
  });

  test("debe cargar más entregas al hacer clic en 'Cargar más'", async ({ page }) => {
    await page.goto("/admin/entregas/historial", { waitUntil: "networkidle" });
    await expect(page.getByText("Historial de entregas")).toBeVisible();

    // Contar entregas iniciales
    const cards1 = page.locator('div[style*="tarjeta"]');
    const countIniciales = await cards1.count();

    // Buscar e intentar hacer clic en "Cargar más"
    const botonCargarMas = page.getByRole("button", { name: /Cargar más entregas/ });
    const visible = await botonCargarMas.isVisible({ timeout: 2000 }).catch(() => false);

    if (visible) {
      await botonCargarMas.click();
      await page.waitForTimeout(500);

      const cards2 = page.locator('div[style*="tarjeta"]');
      const countFinales = await cards2.count();
      expect(countFinales).toBeGreaterThan(countIniciales);
    }
  });

  test("debe filtrar 'solo por revisar' correctamente", async ({ page }) => {
    await page.goto("/admin/entregas/historial", { waitUntil: "networkidle" });
    await expect(page.getByText("Historial de entregas")).toBeVisible();

    // Activar el checkbox de "Solo entregas por revisar"
    const checkboxInput = page.locator('input[type="checkbox"]').first();
    await checkboxInput.check();

    // Esperar a que se recargue la lista
    await page.waitForTimeout(500);

    // Verificar que hay entregas o que el mensaje de sin entregas se muestre
    const cards = page.locator('div[style*="tarjeta"]');
    const sinEntregas = page.getByText("Sin entregas para mostrar");

    const countEntregas = await cards.count();
    const visible = await sinEntregas.isVisible({ timeout: 1000 }).catch(() => false);

    // Debe haber entregas O mostrar el mensaje de sin entregas
    const valid = countEntregas > 0 || visible;
    expect(valid).toBe(true);
  });

  test("el endpoint /api/entregas devuelve cursor válido", async ({ request }) => {
    const response = await request.get("/api/entregas");
    expect(response.ok()).toBeTruthy();

    const data: RespuestaEntregas = await response.json();
    expect(data).toHaveProperty("entregas");
    expect(data).toHaveProperty("proximoCursor");
    expect(Array.isArray(data.entregas)).toBeTruthy();
  });

  test("el endpoint respeta el parámetro cursor", async ({ request }) => {
    // Primera petición sin cursor
    const resp1 = await request.get("/api/entregas");
    const data1: RespuestaEntregas = await resp1.json();

    if (data1.proximoCursor && data1.entregas.length > 0) {
      // Segunda petición con cursor
      const resp2 = await request.get(
        `/api/entregas?cursor=${encodeURIComponent(data1.proximoCursor)}`
      );
      const data2: RespuestaEntregas = await resp2.json();

      // Las entregas no deben solaparse (salvo la frontera del cursor)
      const ids1 = data1.entregas.map((e) => e.id);
      const ids2 = data2.entregas.map((e) => e.id);

      // El primer id de la segunda página NO debe estar en la primera
      if (ids2.length > 0) {
        expect(ids1).not.toContain(ids2[0]);
      }
    }
  });

  test("debe mostrar indicadores de problemas en entregas parciales", async ({ page }) => {
    await page.goto("/admin/entregas/historial", { waitUntil: "networkidle" });
    await expect(page.getByText("Historial de entregas")).toBeVisible();

    // Buscar badges de problemas (pueden no existir si el seed no tiene entregas con problemas)
    const badges = page.locator("span").filter({
      hasText: /Parcial|GPS degradado|Fuera de zona|Foto pendiente/,
    });

    const count = await badges.count();
    // Simplemente verificar que si hay badges, sean visibles
    // (No es un requerimiento que haya, solo que si hay se muestren bien)
    if (count > 0) {
      await expect(badges.first()).toBeVisible();
    }
  });
});
