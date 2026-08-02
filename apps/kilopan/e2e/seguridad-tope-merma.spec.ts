import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Anexo B del prompt correctivo (mutante de control #1): el tope de merma —"no puedes
// mermar más de lo que hay"— es un arreglo del red-team del 26-jul-2026 sin NINGÚN
// test automatizado, descubierto auditando el arnés para Ola 1. `check.sh --full`
// pasaba en verde sin haber ejercitado esta línea ni una vez: si alguien revertía
// apps/kilopan/src/app/api/pesajes/route.ts:186-194 (el chequeo de
// pan.stock_disponible antes de aceptar una merma), el gate no se enteraba.
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

// preparar-base.mjs prende pesaje_foto_obligatoria=1 (AC-PES-04): todo pesaje real
// exige un sha256 con forma válida. El servidor no reverifica el binario en esta ruta
// (a diferencia del POD), así que un hex de 64 caracteres basta para el contrato.
const FOTO_FALSA = "a".repeat(64);

async function stockDe(page: Page, nombreProducto: string): Promise<number> {
  const r = await page.request.get("/api/productos");
  const { productos } = (await r.json()) as { productos: { nombre: string; stock_disponible_g: number }[] };
  return productos.find((p) => p.nombre === nombreProducto)?.stock_disponible_g ?? 0;
}

// P1 (auditoría 1-ago-2026): IP de prueba propia — ver camino-dorado.spec.ts para el
// detalle completo de por qué (limitador de intentos compartido, AC-SEC-02).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.50" } });

// Un solo login para las dos aserciones (mutante + control): cada `ingresar()` de más
// en el e2e completo es una oportunidad más para la carrera de cookie/RSC documentada
// en docs/BITACORA.md — confirmado en vivo el 2-ago-2026, un segundo archivo de specs
// nuevo alcanzó a empujar el conteo total de logins del e2e completo sobre el mismo
// umbral que ya había obligado a fusionar los tests de seguridad-turnos-caja.spec.ts.
test("Anexo B #1: no se puede mermar más gramos de los que hay disponibles, y el control dentro del tope", async ({
  page,
}) => {
  await ingresar(page, "maestro");

  // Hallulla: preparar-base.mjs siembra 5 pesajes de 1000g a mostrador (5.000g),
  // sin tocar en ningún otro spec de este repo — el stock exacto disponible AHORA
  // es lo que importa, así que se lee en vivo en vez de asumir un número fijo.
  const stockAntes = await stockDe(page, "Hallulla");
  expect(stockAntes).toBeGreaterThan(0);

  const rechazo = await page.request.post("/api/pesajes", {
    data: {
      clientUuid: crypto.randomUUID(),
      productoId: datos.productos.Hallulla,
      gramos: stockAntes + 50_000, // muy por sobre lo disponible
      destino: "merma",
      motivoMerma: "quemado",
      fotoSha256: FOTO_FALSA,
      // Sin esto, un pesaje tan grande también dispara el centinela de outlier
      // (AC-PES-03) y ese 409 tapa el que este test quiere aislar: el tope de merma
      // en sí. Confirmar el outlier deja pasar la request hasta el chequeo real.
      confirmarOutlier: true,
    },
  });
  expect(rechazo.status()).toBe(409);
  const cuerpo = (await rechazo.json()) as { error?: string };
  expect(cuerpo.error ?? "").toMatch(/mermar más|stock/i);

  const stockTrasRechazo = await stockDe(page, "Hallulla");
  expect(stockTrasRechazo).toBe(stockAntes); // rechazado de verdad: el stock no se movió

  // Control: una merma DENTRO del stock disponible sí se acepta y lo descuenta.
  const aceptado = await page.request.post("/api/pesajes", {
    data: {
      clientUuid: crypto.randomUUID(),
      productoId: datos.productos.Hallulla,
      gramos: 100,
      destino: "merma",
      motivoMerma: "quemado",
      fotoSha256: FOTO_FALSA,
    },
  });
  expect(aceptado.ok()).toBeTruthy();

  const stockFinal = await stockDe(page, "Hallulla");
  expect(stockAntes - stockFinal).toBe(100);
});
