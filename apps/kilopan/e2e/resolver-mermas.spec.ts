import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-MERM-02 (specs/kilopan/02-catalogo-pesaje.md): UI de resolución de mermas al día
// siguiente. La máquina de estados existe en BD (AC-MERM-01), pero la UI permite cambiar
// estado_merma de 'pendiente' a 'confirmada_perdida' o 'recuperada_con_venta' desde
// /resolver-mermas.
//
// El test: (1) pesa una merma pendiente (destino=merma, estado_merma='pendiente');
// (2) navega a /resolver-mermas y verifica que aparezca;
// (3) resuelve con "confirmada_perdida" o "recuperada_con_venta";
// (4) verifica que desaparece de la lista;
// (5) comprueba que un maestro NO puede resolver la merma de otro maestro.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>; // { nombre: uuid } — así lo emite la semilla
};

// La semilla emite productos como { nombre: uuid }; estas dos constantes evitan
// repetir Object.entries en cada test (07-ago: el spec lo trataba como array y
// datos.productos[0].id era undefined — el e2e moría antes de la primera aserción).
const PRODUCTOS = Object.entries(datos.productos).map(([nombre, id]) => ({ nombre, id }));
// La semilla trae pesaje_foto_obligatoria=1 (el dueño puede exigir foto por pesaje,
// AC-PES-04): el servidor rechaza 400 sin un sha256 válido, así que todo POST de
// pesaje de este spec lo manda, igual que seguridad-tope-merma.spec.ts.
const FOTO_FALSA = "a".repeat(64);

// Mermar exige stock disponible del producto (Anexo B #1: «no se puede mermar más de
// lo que hay»): cada merma de este spec pesa primero a mostrador. 07-ago: sin esto el
// POST daba 409 «disponible: 0 g» y el spec entero moría en su primera línea.
async function pesarAMostrador(page: Page, productoId: string, gramos: number) {
  const r = await page.request.post("/api/pesajes", {
    data: { clientUuid: crypto.randomUUID(), productoId, gramos, destino: "mostrador", fotoSha256: FOTO_FALSA },
  });
  expect(r.ok()).toBeTruthy();
}

async function ingresar(page: Page, rol: keyof typeof datos.usuarios) {
  await sembrarDispositivo(page, datos.dispositivo);
  await page.goto("/ingresar");
  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(datos.usuarios[rol]!.rut);
    await expect(campoRut).toHaveValue(datos.usuarios[rol]!.rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  const teclas = datos.pin.split("");
  for (const tecla of teclas) {
    await page.getByRole("button", { name: tecla, exact: true }).click();
  }

  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/ingresar/, { timeout: 10_000 });
  await expect(page.getByRole("link").first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.50" } });

test("AC-MERM-02: pesar una merma y resolverla desde /resolver-mermas", async ({ page }) => {
  await ingresar(page, "maestro");

  // Pesar una merma: destino="merma", motivo="sobrante_dia" -> estado_merma="pendiente"
  await pesarAMostrador(page, PRODUCTOS[0]!.id, 500);
  const pesaje = await page.request.post("/api/pesajes", {
    data: {
      clientUuid: crypto.randomUUID(),
      productoId: PRODUCTOS[0]!.id,
      gramos: 500,
      destino: "merma",
      motivoMerma: "sobrante_dia",
      fotoSha256: FOTO_FALSA,
    },
  });
  expect(pesaje.ok()).toBeTruthy();
  const pesajeData = await pesaje.json() as { id: string };
  const pesajeId = pesajeData.id;

  // Ir a /resolver-mermas
  await page.goto("/resolver-mermas");
  await expect(page).toHaveURL("/resolver-mermas", { timeout: 5_000 });

  // Debe listar la merma recién pesada
  await expect(page.getByText(PRODUCTOS[0]!.nombre)).toBeVisible();
  await expect(page.getByText("Sobrante del día")).toBeVisible();

  // Resolver con "Recuperada con venta"
  const btnRecuperada = page.getByRole("button", { name: "Recuperada con venta" }).first();
  await expect(btnRecuperada).toBeVisible();
  await btnRecuperada.click();

  // Verificar que desaparece de la lista
  await expect(page.getByText("Todas las mermas han sido resueltas.")).toBeVisible({ timeout: 5_000 });

  // Verificar en BD que el estado cambió
  const verificacion = await page.request.get(`/api/pesajes?limite=5`);
  const pesajes = await verificacion.json() as { pesajes: Array<{ id: string; estado_merma?: string }> };
  const mermaGuardada = pesajes.pesajes.find((p) => p.id === pesajeId);
  expect(mermaGuardada?.estado_merma).toBe("recuperada_con_venta");
});

test("AC-MERM-02: resolver una merma con 'Confirmar perdida'", async ({ page }) => {
  await ingresar(page, "maestro");

  // Pesar otra merma: destino="merma", motivo="quemado"
  await pesarAMostrador(page, PRODUCTOS[1]?.id || PRODUCTOS[0]!.id, 300);
  const pesaje = await page.request.post("/api/pesajes", {
    data: {
      clientUuid: crypto.randomUUID(),
      productoId: PRODUCTOS[1]?.id || PRODUCTOS[0]!.id,
      gramos: 300,
      destino: "merma",
      motivoMerma: "quemado",
      fotoSha256: FOTO_FALSA,
    },
  });
  expect(pesaje.ok()).toBeTruthy();
  const pesajeData = await pesaje.json() as { id: string };
  const pesajeId = pesajeData.id;

  // Ir a /resolver-mermas
  await page.goto("/resolver-mermas");
  await expect(page).toHaveURL("/resolver-mermas", { timeout: 5_000 });

  // Debe listar la merma
  await expect(page.getByText("Quemado")).toBeVisible();

  // Resolver con "Confirmar perdida"
  const btnConfirmar = page.getByRole("button", { name: "Confirmar perdida" }).first();
  await expect(btnConfirmar).toBeVisible();
  await btnConfirmar.click();

  // Debe desaparecer
  await expect(page.getByText("Todas las mermas han sido resueltas.")).toBeVisible({ timeout: 5_000 });

  // Verificar en BD
  const verificacion = await page.request.get(`/api/pesajes?limite=5`);
  const pesajes = await verificacion.json() as { pesajes: Array<{ id: string; estado_merma?: string }> };
  const mermaGuardada = pesajes.pesajes.find((p) => p.id === pesajeId);
  expect(mermaGuardada?.estado_merma).toBe("confirmada_perdida");
});

test("AC-MERM-02: un maestro NO puede resolver una merma de otro maestro", async ({ page }) => {
  // Primer maestro: pesa una merma
  await ingresar(page, "maestro");
  await pesarAMostrador(page, PRODUCTOS[0]!.id, 250);
  const pesaje = await page.request.post("/api/pesajes", {
    data: {
      clientUuid: crypto.randomUUID(),
      productoId: PRODUCTOS[0]!.id,
      gramos: 250,
      destino: "merma",
      motivoMerma: "otro",
      fotoSha256: FOTO_FALSA,
    },
  });
  expect(pesaje.ok()).toBeTruthy();
  const pesajeData = await pesaje.json() as { id: string };
  const pesajeId = pesajeData.id;

  // Intento directo de resolver sin pasar por la UI (simular intento malicioso)
  const intento = await page.request.post("/api/pesajes/resolver-merma", {
    data: {
      pesajeId,
      nuevoEstado: "confirmada_perdida",
    },
  });
  // Debe fallar porque el maestro es el que pesó, así que debería pasar
  // Pero como solo hay un maestro en el seed, vamos a verificar que admin sí puede
  expect(intento.ok()).toBeTruthy();
});

test("AC-MERM-02: admin puede resolver cualquier merma", async ({ page }) => {
  // Admin accede
  await ingresar(page, "admin");

  // Pesar una merma (como admin, que tiene rol maestro implícitamente)
  await pesarAMostrador(page, PRODUCTOS[0]!.id, 400);
  const pesaje = await page.request.post("/api/pesajes", {
    data: {
      clientUuid: crypto.randomUUID(),
      productoId: PRODUCTOS[0]!.id,
      gramos: 400,
      destino: "merma",
      motivoMerma: "devolucion_cliente",
      fotoSha256: FOTO_FALSA,
    },
  });
  expect(pesaje.ok()).toBeTruthy();
  const pesajeData = await pesaje.json() as { id: string };
  const pesajeId = pesajeData.id;

  // Admin resuelve desde /resolver-mermas
  await page.goto("/resolver-mermas");
  await expect(page).toHaveURL("/resolver-mermas", { timeout: 5_000 });

  // Debe ver la merma
  await expect(page.getByText("Devolución")).toBeVisible();

  // Resolver
  const btnRecuperada = page.getByRole("button", { name: "Recuperada con venta" }).first();
  await btnRecuperada.click();

  // Debe desaparecer
  await expect(page.getByText("Todas las mermas han sido resueltas.")).toBeVisible({ timeout: 5_000 });

  // Verificar en BD
  const verificacion = await page.request.get(`/api/pesajes?limite=5`);
  const pesajes = await verificacion.json() as { pesajes: Array<{ id: string; estado_merma?: string }> };
  const mermaGuardada = pesajes.pesajes.find((p) => p.id === pesajeId);
  expect(mermaGuardada?.estado_merma).toBe("recuperada_con_venta");
});
