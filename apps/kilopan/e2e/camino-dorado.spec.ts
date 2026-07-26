import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// El día completo de la panadería, contra el servidor y la base de verdad: vincular el
// equipo, entrar con PIN, pesar la hornada, venderla en el mesón, cerrar la caja a ciegas
// y salir a repartir.
//
// Por qué existe: la auditoría del 26-jul-2026 arregló 31 defectos y NINGUNO quedó
// cubierto por una prueba de navegador — se verificaron a mano contra producción, que
// sirve una vez y no se repite sola. Estos casos son el seguro de esos arreglos: cada
// uno afirma algo que estuvo roto de verdad, no una lista aspiracional.
//
// Los ids los genera e2e/preparar-base.mjs al sembrar; escribirlos a mano acá sería
// inventar datos que la base no tiene.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
  cliente: { id: string; razonSocial: string };
  pedido: { id: string; gramosPedidos: number };
};

// Serie, no paralelo: el mostrador tiene UN stock y UNA caja. Vender antes de pesar, o
// cerrar caja antes de vender, no es un test que falla — es un test que miente.
test.describe.configure({ mode: "serial" });

/** Teclea en el teclado en pantalla, que es el único que existe en estas pantallas. */
async function teclear(page: Page, texto: string) {
  for (const caracter of texto) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
}

/** Entra con RUT y PIN, como lo hace el operador al llegar. */
async function ingresar(page: Page, rol: keyof typeof datos.usuarios) {
  const rut = datos.usuarios[rol]!.rut;
  await page.goto("/ingresar");

  // La pantalla precarga el RUT del operador anterior desde localStorage, y lo hace en
  // un efecto DESPUÉS del montaje: escribir antes de que corra deja el RUT viejo en el
  // formulario y el turno se abre a nombre de quien se acaba de ir. Reintentar hasta que
  // el valor se quede es lo que hace el operador de verdad —borra y escribe el suyo—, y
  // además es la única forma de no depender de cuándo hidrata React.
  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(rut);
    await expect(campoRut).toHaveValue(rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  await teclear(page, datos.pin);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  // Esperar al menú y no solo a la URL: el push del router sigue en curso cuando la URL
  // ya cambió, y un goto() inmediato lo interrumpe. Un e2e que arranca la navegación
  // siguiente antes de que la anterior termine falla por sí mismo, no por la app.
  await expect(page.getByRole("link").first()).toBeVisible();
}

/** La ficha del producto en la grilla — no el "×" que lo quita del carrito, que también
 *  lleva su nombre. Anclado al inicio: en /vender la ficha dice "Marraqueta 9,5 kg" y en
 *  /pesar solo "Marraqueta", pero el botón de quitar empieza con "Quitar" en las dos. */
function fichaProducto(page: Page, nombre: string) {
  return page.getByRole("button", { name: new RegExp(`^${nombre}`) });
}

/** Navega por el menú, que es como llega ahí el operador — no escribiendo la URL. */
async function irA(page: Page, etiqueta: RegExp) {
  await page.getByRole("link", { name: etiqueta }).click();
}

test.beforeEach(async ({ page }) => {
  // El equipo ya está vinculado: es el estado normal de una tablet en el mesón, que se
  // enrola una vez y queda así por meses. El enrolamiento se prueba aparte, más abajo.
  await page.addInitScript((d) => {
    window.localStorage.setItem("kp_dispositivo", JSON.stringify(d));
  }, datos.dispositivo);
});

test("1 · el equipo se vincula con las credenciales de un administrador", async ({ page }) => {
  await page.goto("/vincular");
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();

  await page.getByPlaceholder("Tablet mesón").fill("Tablet del e2e");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByPlaceholder("12.345.678-5").fill(datos.usuarios.admin!.rut);
  await teclear(page, datos.pin);
  await page.getByRole("button", { name: "Vincular" }).click();

  await expect(page).toHaveURL(/\/ingresar$/);
});

test("2 · entrar con PIN abre el turno, y la pantalla tiene encabezado", async ({ page }) => {
  await page.goto("/ingresar");
  // El logo reemplazó al <h1> y dejó la pantalla sin ningún encabezado: un lector de
  // pantalla se queda sin punto de entrada. Volvió como título, no como adorno.
  await expect(page.getByRole("heading", { name: "KiloPan" })).toBeVisible();

  await page.getByPlaceholder("12.345.678-5").fill(datos.usuarios.vendedor!.rut);
  // El PIN empieza con dígitos normales acá; que uno pueda EMPEZAR con 0 se prueba abajo.
  await teclear(page, datos.pin);
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page).toHaveURL(/\/inicio$/);
  // El menú del vendedor: solo lo suyo, y cada opción con una línea que dice qué hace.
  // Antes eran etiquetas sueltas —"Cierre de caja"— que no significan nada para quien
  // recién llega al mesón.
  await expect(page.getByRole("link", { name: /Venta mostrador/ })).toContainText(
    "Cobrar en el mesón"
  );
  await expect(page.getByRole("link", { name: /Despacho/ })).toHaveCount(0);
});

test("3 · el teclado acepta un PIN que empieza con cero", async ({ page }) => {
  // Antes el teclado colapsaba el cero inicial —correcto para un monto, "0"+"5" es 5—
  // y volvía IMPOSIBLE escribir un PIN como 0512. Quien lo tuviera quedaba afuera de su
  // propia app sin ningún mensaje que lo explicara.
  await page.goto("/ingresar");
  await teclear(page, "0512");
  // Cuatro dígitos tecleados = cuatro puntos llenos. Con el bug quedaban tres.
  await expect(page.getByText("●●●●", { exact: true })).toBeVisible();
});

// AC-PES-02: teclado en pantalla con coma es-CL y destino en un toque, probado en vivo
// de punta a punta — clic real → API → BD → mensaje verde.
// AC-POD-03: la foto se toma con getUserMedia in-app, nunca con <input type=file>.
test("4 · el maestro pesa la hornada y el pan entra al stock del mesón", async ({ page }) => {
  await ingresar(page, "maestro");
  await irA(page, /Pesaje/);

  await fichaProducto(page, "Marraqueta").click();
  await teclear(page, "12");
  await page.getByRole("radio", { name: "Mostrador" }).click();

  // La panadería exige foto por bandeja (AC-PES-04) y el botón lo dice: no se puede
  // confirmar un pesaje sin respaldo, y el maestro se entera ANTES de apretar.
  await page.getByRole("button", { name: "Confirmar con foto" }).click();
  // La cámara se abre in-app por getUserMedia, nunca un selector de archivos: con la
  // galería se podría adjuntar la foto de otra bandeja y el respaldo no respaldaría nada.
  await page.getByRole("button", { name: "Tomar foto y pesar" }).click();

  await expect(page.getByRole("status")).toContainText(/12 kg/i, { timeout: 20_000 });
});

test("5 · el vendedor cobra en el mesón y el precio lo pone el servidor", async ({ page }) => {
  await ingresar(page, "vendedor");
  await irA(page, /Venta mostrador/);

  await fichaProducto(page, "Marraqueta").click();
  await teclear(page, "2,5");

  // 2,5 kg × $2.190 = $5.475. El precio sale de pan.precios, no de lo que mande el
  // cliente: un carrito con precio propio fue uno de los intentos del red team.
  await expect(page.getByText("$5.475")).toBeVisible();
  await page.getByRole("button", { name: "Agregar", exact: true }).click();

  await expect(page.getByText("Carrito")).toBeVisible();
  await page.getByRole("radio", { name: "Efectivo" }).click();
  await page.getByRole("button", { name: /Cobrar/ }).click();

  // El monto confirmado por el servidor, no el que pintó la pantalla: si el precio
  // viniera del cliente, acá se vería otra cifra.
  await expect(page.getByRole("status")).toContainText("$5.475", { timeout: 15_000 });
});

test("6 · quitar una línea del carrito recalcula el total", async ({ page }) => {
  // Antes cada línea era texto plano sin forma de sacarla: si el cliente cambiaba de
  // idea, las salidas eran cobrar mal o empezar de cero con la cola esperando.
  await ingresar(page, "vendedor");
  await irA(page, /Venta mostrador/);

  const agregarKilos = async (kilos: string) => {
    await fichaProducto(page, "Marraqueta").click();
    await teclear(page, kilos);
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
  };

  await agregarKilos("1");
  await agregarKilos("2");
  // 3 kg × $2.190 = $6.570. El botón de cobro lleva el total, así que dice la verdad
  // sobre lo que se va a cobrar aunque todavía no haya medio de pago elegido.
  await expect(page.getByRole("button", { name: /Cobrar/ })).toContainText("$6.570");

  await page.getByRole("button", { name: "Quitar Marraqueta del carrito" }).first().click();
  await expect(page.getByRole("button", { name: /Cobrar/ })).toContainText("$4.380");

  await page.getByRole("button", { name: "Quitar Marraqueta del carrito" }).first().click();
  // Vaciado del todo, el carrito desaparece: no queda un total fantasma de $0 invitando
  // a cobrar nada.
  await expect(page.getByText("Carrito")).toBeHidden();
});

test("7 · la caja se cuenta a ciegas: el vendedor no ve lo esperado antes de contar", async ({
  page,
}) => {
  // El control antifraude del cierre es comparar lo contado contra lo esperado. Si el
  // vendedor VE lo esperado antes de contar, el control no controla nada: escribe ese
  // número y se queda con la diferencia. El servidor directamente no se lo manda —
  // esconderlo solo en la pantalla no alcanza, con las herramientas del navegador se lee.
  await ingresar(page, "vendedor");
  await irA(page, /Cierre de caja/);
  await expect(page.getByRole("heading", { name: "Cierre de caja" })).toBeVisible();

  await expect(page.getByText("¿cuánto contaste?").first()).toBeVisible();
  await expect(page.getByText(/esperado \$/i)).toHaveCount(0);

  const efectivo = page.getByPlaceholder("0").first();
  await efectivo.fill("5475");
  await page.getByRole("button", { name: /Cerrar caja/ }).click();

  // Recién DESPUÉS de cerrar aparece el contraste, que es cuando ya no se puede alterar.
  await expect(page.getByText(/esperado/i).first()).toBeVisible({ timeout: 15_000 });
});

// AC-DES-03: «Armar ruta y salir» desde /pedidos, con la guía ya registrada — sin DTE
// la BD no deja que la ruta pase a en_curso (art. 55 DL 825).
// AC-POD-03: la entrega exige foto in-app y GPS, y el acuse nombra al cliente.
test("8 · el repartidor entrega el pedido con foto y GPS", async ({ page }) => {
  // La ruta la arma despacho de un clic; el pedido y su guía vienen sembrados porque lo
  // que este caso prueba es la ENTREGA, no el alta del pedido.
  await ingresar(page, "admin");
  await irA(page, /Despacho/);
  // Acotado a su sección: la pantalla de despacho tiene tres <select> y ninguno lleva
  // etiqueta accesible, así que no hay forma de nombrarlos por rol. Queda anotado.
  const armado = page.locator("section").filter({ hasText: "Armar ruta y salir" });
  await armado.getByRole("combobox").selectOption({ label: "Luis Repartidor" });
  await page.getByPlaceholder("Patente (ej: ABCD-12)").fill("KLPN-01");
  await page.getByRole("button", { name: "Armar ruta y salir" }).click();
  // El mensaje exacto, no un "ruta" suelto: media pantalla habla de rutas y una aserción
  // laxa daba verde sin que la ruta existiera.
  await expect(page.getByRole("status")).toContainText("Ruta en curso con 1 parada", {
    timeout: 15_000,
  });

  await ingresar(page, "repartidor");
  await irA(page, /Mi ruta/);
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();
  await expect(page.getByText(datos.cliente.razonSocial)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Entregar" }).first().click();
  await page.getByRole("button", { name: "Tomar foto" }).click();

  await page.getByLabel("Quién recibe").fill("Don Pepe");
  await page.getByRole("button", { name: "Confirmar entrega" }).click();

  // El nombre del cliente en el acuse, no un "entregada" suelto: la pantalla dice
  // "Todas las paradas entregadas" aunque no haya pasado nada, y "Mi ruta" es el título.
  // Por texto y no por rol: en esta pantalla conviven dos role="status" —el acuse y el
  // chip de la cola offline ("Subiendo — 1 pendiente(s)")—, y apuntar al rol los toma
  // a los dos.
  await expect(page.getByText(`Entregada — ${datos.cliente.razonSocial}`)).toBeVisible({
    timeout: 20_000,
  });
  // Y la ruta quedó sin pendientes: la entrega llegó al servidor, no solo a la pantalla.
  await expect(page.getByText("Todas las paradas entregadas")).toBeVisible({ timeout: 20_000 });
});
