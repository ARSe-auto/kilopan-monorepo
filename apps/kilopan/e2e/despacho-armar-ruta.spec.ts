import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar, teclear } from "./ingresar.ts";

// AC-DES-03: F2 «Armar pedido» de /pedidos (specs/kilopan/04-despacho-reparto.md, Fuente:
// §3). Evidencia PROPIA y REPETIBLE del AC, para cerrar el HUECO del Anexo D: el único e2e
// que ejercitaba «Armar ruta y salir» de punta a punta era camino-dorado.spec.ts test 8, el
// mismo test que AC-POD-04 declara flaky. Este AC no necesita ESE test — pide su propia
// evidencia. Dos frentes, con datos propios (nunca los del camino dorado):
//   1. Pantalla: alta de cliente, pedido con el precio de la lista del cliente, y el bloqueo
//      del art. 55 DL 825 VISIBLE (pedido sin documento en rojo) que se apaga al asociar la
//      guía desde la propia pantalla.
//   2. HTTP puro sobre el camino de salida: 409 sin guía (mensaje del art. 55), 200 con guía.
// El invariante de BD del art. 55 vive aparte, en db/test-invariantes.mjs (AC-DES-02); esto
// cubre la pantalla y el contrato HTTP que el Anexo D marcó como hueco.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
  cliente: { id: string; razonSocial: string };
  repartidorDespacho4: { id: string };
};

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.63" } });

// Cliente propio del test 1, con RUT de DV correcto (valida_rut) que no colisiona con el
// seed. La razón social es única: sirve para ubicar EXACTAMENTE mi pedido en una lista que
// puede traer los pedidos de otros specs corridos antes contra la misma base.
const RAZON_SOCIAL = "Panadería DES-03 e2e";
const RUT_CLIENTE = "77.777.777-7";

test("AC-DES-03: pantalla — alta de cliente, pedido con precio de lista y art. 55 en rojo→verde", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);
  await page.goto("/pedidos");

  // Alta de cliente desde la pantalla (canal reparto → queda autoseleccionado).
  await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
  await page.getByPlaceholder("Razón social").fill(RAZON_SOCIAL);
  await page.getByPlaceholder("RUT (ej: 12.345.678-5)").fill(RUT_CLIENTE);
  await page.getByPlaceholder("Dirección de entrega").fill("Calle Falsa 123");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText(`Cliente «${RAZON_SOCIAL}» dado de alta`)).toBeVisible();

  // Pedido de 10 kg de Marraqueta. El precio sale de la lista del cliente (mayorista,
  // $1.650/kg en la semilla): 10 kg × $1.650 = $16.500. Ese total, no cero ni un valor
  // tecleado a mano, es la prueba de «precio de la lista del cliente».
  await page.locator("select").filter({ hasText: "Producto…" }).selectOption({ label: "Marraqueta" });
  await page.getByPlaceholder("Kilos (ej: 12)").fill("10");
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByText(/Pedido N° .* · \$?16\.500/)).toBeVisible();

  // MI tarjeta exacta: el nombre del cliente vive en un <span> cuyo abuelo es la tarjeta
  // (span → div.flex → div.tarjeta), así que `../..` la aísla SIN caer en divs ancestros
  // que —en el gate completo— contienen los pedidos sin DTE de otros specs (esa fue la
  // trampa: filtrar por razón social matcheaba también la sección entera, y el aviso rojo
  // de OTROS pedidos nunca llegaba a cero). La razón social es única ⇒ un solo <span>.
  const miTarjeta = page.getByText(`· ${RAZON_SOCIAL}`).locator("xpath=../..");

  // Nace en rojo: el bloqueo del art. 55 se VE en pantalla como el aviso «Sin documento
  // asociado». (El borde rojo es el mismo estado; el texto es lo aserto­able sin estilo.)
  await expect(miTarjeta.getByText("Sin documento asociado")).toBeVisible();

  // Asociar la guía desde la propia pantalla (el panel «Registrar documento del SII»).
  await miTarjeta.getByRole("button", { name: "Asociar guía o factura" }).click();
  await page.getByPlaceholder("Folio").fill("970001");
  // El monto ya no es un <input placeholder="Monto total">: AC-H0-13 lo cambió por un
  // botón que abre el teclado GRANDE propio (campo de plata = teclado propio, §5). El
  // aria-label del botón dice «Monto total: …», y se teclea con los botones del teclado.
  await page.getByRole("button", { name: /Monto total/ }).click();
  await teclear(page, "33000");
  await page.getByRole("button", { name: "Listo" }).click();
  await page.getByRole("button", { name: "Registrar documento" }).click();
  await expect(page.getByText("Documento 52 folio 970001 registrado")).toBeVisible();

  // Con el documento asociado, el aviso rojo del art. 55 se apaga en MI pedido y pasa a
  // verde. La salida a ruta ya no queda bloqueada por él.
  await expect(miTarjeta.getByText("documento(s) registrado")).toBeVisible();
  await expect(miTarjeta.getByText("Sin documento asociado")).toHaveCount(0);
});

test("AC-DES-03: HTTP — «Salir a ruta» rebota 409 sin guía y sale 200 con guía", async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);
  const fechaEntrega = new Date().toISOString().slice(0, 10);

  // Pedido SIN documento, con page.request para compartir la cookie de sesión del admin.
  const pedido = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 5000 }],
    },
  });
  expect(pedido.ok()).toBeTruthy();
  const { id: pedidoId } = (await pedido.json()) as { id: string };

  // Armar la ruta con el repartidor propio del test (libre de toda otra ruta del día).
  const ruta = await page.request.post("/api/rutas", {
    data: { repartidorId: datos.repartidorDespacho4.id, vehiculo: "DES-03", pedidoIds: [pedidoId] },
  });
  expect(ruta.ok()).toBeTruthy();
  const { id: rutaId } = (await ruta.json()) as { id: string };

  // Salir SIN guía: el trigger de pan.rutas (art. 55 DL 825) rebota → 409 con su motivo.
  const sinGuia = await page.request.patch("/api/rutas", {
    data: { rutaId, estado: "en_curso", kmInicio: 0 },
  });
  expect(sinGuia.status()).toBe(409);
  const cuerpoSin = (await sinGuia.json()) as { error: string };
  expect(cuerpoSin.error).toMatch(/art\. 55/i);

  // Registrar la guía de despacho (DTE 52) del pedido.
  const dte = await page.request.post("/api/dte", {
    data: {
      tipoDte: 52,
      folioSii: 970003,
      rutEmisor: "76.192.083-9",
      montoTotal: 8250,
      pedidoId,
      indTraslado: 1,
    },
  });
  expect(dte.ok()).toBeTruthy();

  // Ahora la misma salida pasa: 200 y la ruta queda en curso.
  const conGuia = await page.request.patch("/api/rutas", {
    data: { rutaId, estado: "en_curso", kmInicio: 0 },
  });
  expect(conGuia.ok()).toBeTruthy();
  const cuerpoCon = (await conGuia.json()) as { estado: string };
  expect(cuerpoCon.estado).toBe("en_curso");
});
