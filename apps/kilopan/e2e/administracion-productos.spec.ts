import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-ADM-02 (specs/kilopan/10-administracion.md): dar de alta pan nuevo y editar
// precios desde la propia app (`/admin` + `POST/PATCH /api/productos`) — antes solo
// existía por SQL directo. Se ataca la ruta real por HTTP con sesión de admin de verdad
// (login por pantalla): alta (dup → 409, datos inválidos → 400), cambio de precio y
// activar/desactivar, y que un no-admin rebota por el SERVIDOR (403), misma lección que
// `pesaje_foto_obligatoria` y AC-ADM-04.
//
// La afirmación central de la spec —«cambiar un precio crea una fila nueva, jamás edita
// la vigente»— es sobre el HISTORIAL de `pan.precios`, y por HTTP el catálogo solo
// expone el precio VIGENTE de hoy (no hay GET que liste versiones pasadas): probarla de
// verdad exige leer la tabla directamente, y este e2e corre contra pglite en un solo
// proceso compartido con el servidor (no admite una segunda conexión, ver
// `preparar-base.mjs`). Esa parte vive en `db/test-invariantes.mjs`, que sí puede leer
// la tabla bajo el rol real `pan_app` — mismo patrón que AC-ADM-06 en
// `corregir-cierre-turno.spec.ts`. Acá se prueba lo que SÍ es HTTP: validación de
// entrada, que el precio nuevo quede vigente, y el rechazo por rol.
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
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02).
// .44/.45/.46 ya las usan seguridad-arreglar, anular-venta y corregir-cierre-turno.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.47" } });

test("AC-ADM-02: dar de alta un producto — nombre duplicado 409, datos inválidos 400", async ({ page }) => {
  await ingresar(page, "admin");

  const nombre = `Pan Prueba ${Date.now()}`;
  const alta = await page.request.post("/api/productos", {
    data: { nombre, tipoVenta: "kilo", precioMostradorClp: 1200 },
  });
  expect(alta.ok()).toBeTruthy();
  const cuerpo = await alta.json();
  expect(cuerpo.id).toBeTruthy();

  // El mismo nombre otra vez rebota por la unicidad de `pan.productos.nombre` (0002).
  const duplicado = await page.request.post("/api/productos", {
    data: { nombre, tipoVenta: "kilo", precioMostradorClp: 1500 },
  });
  expect(duplicado.status()).toBe(409);

  const sinNombre = await page.request.post("/api/productos", {
    data: { tipoVenta: "kilo", precioMostradorClp: 1200 },
  });
  expect(sinNombre.status()).toBe(400);

  const tipoInvalido = await page.request.post("/api/productos", {
    data: { nombre: `Pan Prueba B ${Date.now()}`, tipoVenta: "docena", precioMostradorClp: 1200 },
  });
  expect(tipoInvalido.status()).toBe(400);

  const precioInvalido = await page.request.post("/api/productos", {
    data: { nombre: `Pan Prueba C ${Date.now()}`, tipoVenta: "kilo", precioMostradorClp: 0 },
  });
  expect(precioInvalido.status()).toBe(400);
});

test("AC-ADM-02: cambiar el precio deja el catálogo con el precio nuevo vigente, y desactivar saca el producto de /pesar", async ({
  page,
}) => {
  await ingresar(page, "admin");

  const nombre = `Pan Prueba Precio ${Date.now()}`;
  const alta = await page.request.post("/api/productos", {
    data: { nombre, tipoVenta: "kilo", precioMostradorClp: 1000, precioMayoristaClp: 800 },
  });
  expect(alta.ok()).toBeTruthy();
  const { id } = await alta.json();

  const cambio = await page.request.patch("/api/productos", {
    data: { id, precioMostradorClp: 1300, precioMayoristaClp: 900 },
  });
  expect(cambio.ok()).toBeTruthy();

  // El listado de admin (`?detalle=1`) lee el precio VIGENTE con el mismo patrón que
  // `/pesar`: el cambio recién hecho tiene que verse de inmediato, no en un caché viejo.
  const detalle = await page.request.get("/api/productos?detalle=1");
  expect(detalle.ok()).toBeTruthy();
  const { productos } = await detalle.json();
  const propio = productos.find((p: { id: string }) => p.id === id);
  expect(propio).toBeTruthy();
  expect(propio.precio_mostrador_clp).toBe(1300);
  expect(propio.precio_mayorista_clp).toBe(900);
  expect(propio.activo).toBe(true);

  // Desactivar: sigue existiendo (nunca se borra, §4) pero desaparece del listado de
  // /pesar (que filtra `where p.activo`, ver GET sin `detalle`).
  const desactivar = await page.request.patch("/api/productos", { data: { id, activo: false } });
  expect(desactivar.ok()).toBeTruthy();
  const listaPesar = await page.request.get("/api/productos");
  const { productos: enPesar } = await listaPesar.json();
  expect(enPesar.some((p: { id: string }) => p.id === id)).toBe(false);

  const detalleTrasDesactivar = await page.request.get("/api/productos?detalle=1");
  const { productos: conInactivos } = await detalleTrasDesactivar.json();
  expect(conInactivos.find((p: { id: string }) => p.id === id).activo).toBe(false);

  // Reactivar: vuelve a aparecer en /pesar.
  const reactivar = await page.request.patch("/api/productos", { data: { id, activo: true } });
  expect(reactivar.ok()).toBeTruthy();
  const listaPesarTrasReactivar = await page.request.get("/api/productos");
  const { productos: enPesarDeNuevo } = await listaPesarTrasReactivar.json();
  expect(enPesarDeNuevo.some((p: { id: string }) => p.id === id)).toBe(true);

  // Validación de entrada del PATCH.
  const sinId = await page.request.patch("/api/productos", { data: { activo: true } });
  expect(sinId.status()).toBe(400);
  const sinNadaQueCambiar = await page.request.patch("/api/productos", { data: { id } });
  expect(sinNadaQueCambiar.status()).toBe(400);
  const precioInvalido = await page.request.patch("/api/productos", { data: { id, precioMostradorClp: -5 } });
  expect(precioInvalido.status()).toBe(400);
  const idInexistente = await page.request.patch("/api/productos", {
    data: { id: crypto.randomUUID(), activo: true },
  });
  expect(idInexistente.status()).toBe(404);
});

test("AC-ADM-02: un vendedor NO puede dar de alta ni editar productos — el servidor rebota 403", async ({
  page,
}) => {
  await ingresar(page, "vendedor");

  const post = await page.request.post("/api/productos", {
    data: { nombre: `No debería crearse ${Date.now()}`, tipoVenta: "kilo", precioMostradorClp: 1000 },
  });
  expect(post.status()).toBe(403);

  const patch = await page.request.patch("/api/productos", {
    data: { id: crypto.randomUUID(), activo: false },
  });
  expect(patch.status()).toBe(403);
});
