import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Anexo B del prompt correctivo (docs/PROMPT_CORRECTIVO.md): mutantes de control #3, #4
// y #5 — reversiones mecánicas de protecciones ya existentes que DEBEN poner el gate en
// rojo. Auditoría Ola 1 (2-ago-2026): las tres tenían el código de protección real pero
// cero test — check.sh --full pasaba en verde sin haberlas ejercitado ni una vez.
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

async function stockDe(page: Page, nombreProducto: string): Promise<number> {
  const r = await page.request.get("/api/productos");
  const { productos } = (await r.json()) as { productos: { nombre: string; stock_disponible_g: number }[] };
  return productos.find((p) => p.nombre === nombreProducto)?.stock_disponible_g ?? 0;
}

// P1 (auditoría 1-ago-2026): IP de prueba propia — ver camino-dorado.spec.ts para el
// detalle completo (limitador de intentos compartido, AC-SEC-02).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.60" } });

test("Anexo B #3: dos líneas del mismo producto con UUID de distinta capitalización se acumulan como UNA (normalizarUuid en /api/ventas)", async ({
  page,
}) => {
  // Postgres trata `uuid` como insensible a mayúsculas pero el Map de JS que acumula
  // gramos por producto ANTES de chequear stock no — sin normalizarUuid(), dos líneas
  // de la misma marraqueta con el UUID en distinta capitalización pasan el chequeo de
  // stock cada una por separado, y juntas venden más de lo que hay en el mesón
  // (red-team, ALTA — ver comentario en apps/kilopan/src/app/api/ventas/route.ts).
  await ingresar(page, "vendedor");

  // Frica: preparar-base.mjs siembra 10 pesajes de 1000g a destino='mostrador' (10.000g).
  const productoIdMinuscula = datos.productos.Frica!;
  const stockAntes = await stockDe(page, "Frica");
  expect(stockAntes).toBeGreaterThan(0);

  // Dos líneas que suman MÁS que el stock disponible, pero cada una por sí sola
  // (la mitad más 100g) cabe de sobra — solo la suma correcta las rechaza.
  const mitad = Math.floor(stockAntes / 2) + 100;

  const venta = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      lineas: [
        { productoId: productoIdMinuscula, gramos: mitad },
        { productoId: productoIdMinuscula.toUpperCase(), gramos: mitad },
      ],
    },
  });
  expect(venta.status()).toBe(409);

  const stockTrasRechazo = await stockDe(page, "Frica");
  expect(stockTrasRechazo).toBe(stockAntes); // rechazado de verdad: nada se movió
});

test("Anexo B #4: el precio que cobra la venta es SIEMPRE el del catálogo del servidor, nunca el que manda el cliente en el body", async ({
  page,
}) => {
  // apps/kilopan/src/app/api/ventas/route.ts calcula precioLinea con
  // pan.precio_vigente() y solo usa linea.precioClp para DETECTAR divergencia (rebota
  // 409 "precio_cambio" si no calzan) — jamás para cobrar el número que mandó el
  // cliente. Un mutante que "devuelva el precio al cuerpo del request" (confiar en
  // linea.precioClp como el monto a cobrar) dejaría pasar esta venta a $1.
  await ingresar(page, "vendedor");

  // Hallulla: preparar-base.mjs siembra 5 pesajes de 1000g a destino='mostrador' (5.000g).
  const productoId = datos.productos.Hallulla!;
  const stockAntes = await stockDe(page, "Hallulla");
  expect(stockAntes).toBeGreaterThan(0);

  const intentoDeSubfacturar = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      lineas: [{ productoId, gramos: 500, precioClp: 1 }], // muy por debajo del real
    },
  });
  expect(intentoDeSubfacturar.status()).toBe(409);
  const cuerpo = (await intentoDeSubfacturar.json()) as { error?: string };
  expect(cuerpo.error ?? "").toMatch(/precio/i);

  const stockTrasRechazo = await stockDe(page, "Hallulla");
  expect(stockTrasRechazo).toBe(stockAntes); // rechazado de verdad: no se vendió a $1

  // Control: sin precioClp (o con el correcto) la venta se acepta al precio real.
  const ventaHonesta = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      lineas: [{ productoId, gramos: 500 }],
    },
  });
  expect(ventaHonesta.ok()).toBeTruthy();
  const { totalClp } = (await ventaHonesta.json()) as { totalClp: number };
  expect(totalClp).toBeGreaterThan(1); // el precio real de 500g de pan nunca es $1
});

test("Anexo B #5: la cookie de sesión no lleva Expires, solo Max-Age (cabeceraCookieSesion)", async ({
  page,
}) => {
  // apps/kilopan/src/identidad/sesion.ts arma el Set-Cookie A MANO justamente para
  // evitar el Expires que Next deriva de maxAge — esa fecha lleva una coma, y un
  // intermediario que junte headers repetidos puede partir el Set-Cookie ahí, dejando
  // al operador sin sesión pese a un login que respondió 200 (defecto real,
  // 26-jul-2026, documentado en el propio archivo). Sin este test, revertir a
  // `cookies.set()` de Next no lo nota nadie.
  const login = await page.request.post("/api/auth/login", {
    data: {
      rut: datos.usuarios.vendedor!.rut,
      pin: datos.pin,
      dispositivoId: datos.dispositivo.id,
      dispositivoSecreto: datos.dispositivo.secreto,
    },
  });
  expect(login.ok()).toBeTruthy();

  const setCookie = login.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/max-age=/i);
  expect(setCookie).not.toMatch(/expires=/i);
});
