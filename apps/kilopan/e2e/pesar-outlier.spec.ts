import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar, teclear } from "./ingresar.ts";

// AC-PES-08 (specs/kilopan/02-catalogo-pesaje.md): UI de re-confirmación explícita cuando
// `pan.es_outlier_pesaje()` devuelve true — /pesar tiene el estado `confirmar_outlier` y
// conserva el sha256 de la foto entre las dos vueltas de `enviar()` (el maestro no
// fotografía dos veces la misma bandeja). El Anexo D (auditoría 2-ago-2026) marcó HUECO:
// la única evidencia citada era lectura de código ("Verificado en pesar/page.tsx"), no un
// test automatizado.
//
// Producto PROPIO del test, con su mediana sembrada por HTTP: `pan.es_outlier_pesaje()`
// mira TODOS los pesajes de ese producto_id sin importar quién los hizo (0003), así que
// apoyarse en la mediana de Frica/Hallulla de la semilla dependería de cuánto haya pesado
// cada OTRO spec de esos productos antes de que este archivo corra — y de en qué orden
// Playwright decida correrlos. Con un producto que nadie más toca, la mediana es exacta y
// determinística sin importar el resto de la suite.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test.describe.configure({ mode: "serial" });
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.67" } });

const NOMBRE_PRODUCTO = "Producto Outlier PES-08";

/** sha256 válido para el formato que exige el servidor — no necesita ser de un JPEG
 *  real: `/api/pesajes` solo valida el formato del hash, nunca que el archivo exista. */
function shaFalso(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

test("AC-PES-08: un peso outlier exige confirmar, y la confirmación no vuelve a fotografiar", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const alta = await page.request.post("/api/productos", {
    data: { nombre: NOMBRE_PRODUCTO, tipoVenta: "kilo", precioMostradorClp: 1000 },
  });
  expect(alta.ok()).toBeTruthy();
  const { id: productoId } = (await alta.json()) as { id: string };

  // 3 muestras a 500 g por HTTP: mediana exacta = 500 g (es_outlier_pesaje exige n>=3;
  // con menos de 3 SIEMPRE devuelve false, así que hace falta sembrar esto antes de
  // poder disparar el outlier desde la pantalla).
  for (let i = 0; i < 3; i++) {
    const semilla = await page.request.post("/api/pesajes", {
      data: {
        clientUuid: randomUUID(),
        productoId,
        gramos: 500,
        destino: "mostrador",
        fotoSha256: shaFalso(),
      },
    });
    expect(semilla.ok()).toBeTruthy();
  }

  // Se escucha la red DESDE ANTES de tocar nada: la prueba de fondo del AC es que el
  // servidor reciba UNA sola foto y que el segundo /api/pesajes lleve el MISMO sha256
  // que el primero — no alcanza con que la pantalla no vuelva a mostrar la cámara.
  const llamadasFotos: string[] = [];
  const llamadasPesajes: { cuerpo: Record<string, unknown> }[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (req.url().endsWith("/api/fotos")) llamadasFotos.push(req.url());
    if (req.url().endsWith("/api/pesajes")) {
      try {
        llamadasPesajes.push({ cuerpo: JSON.parse(req.postData() ?? "{}") as Record<string, unknown> });
      } catch {
        llamadasPesajes.push({ cuerpo: {} });
      }
    }
  });

  await page.goto("/pesar");
  await page.getByRole("button", { name: NOMBRE_PRODUCTO, exact: true }).click();
  await teclear(page, "5"); // 5 kg = 5.000 g — 10x la mediana de 500 g: outlier seguro.

  // La semilla prende `pesaje_foto_obligatoria` (AC-PES-04): "Confirmar" abre la cámara
  // primero, como en el terreno real.
  await page.getByRole("button", { name: "Confirmar con foto" }).click();
  await expect(page.getByRole("button", { name: "Tomar foto y pesar" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Tomar foto y pesar" }).click();

  // El primer POST vuelve 409 "outlier" y la pantalla exige confirmar — el mensaje
  // nombra el producto Y el peso exacto, no un aviso genérico.
  await expect(
    page.getByText(`Ese peso es muy distinto a lo habitual para ${NOMBRE_PRODUCTO}. ¿Confirmas 5 kg?`)
  ).toBeVisible({ timeout: 10_000 });
  // Nunca volvió a la pantalla de cámara: pasó derecho de "enviando" a "confirmar_outlier".
  await expect(page.getByRole("button", { name: "Tomar foto y pesar" })).toHaveCount(0);

  await page.getByRole("button", { name: "Confirmar", exact: true }).click();

  // Éxito: la tarjeta de siguiente paso confirma que el pesaje quedó registrado de verdad.
  await expect(page.getByText(new RegExp(`Pesado: 5 kg · ${NOMBRE_PRODUCTO}`))).toBeVisible({
    timeout: 10_000,
  });

  // Una sola foto subida — la de antes del rechazo — y el segundo /api/pesajes lleva
  // confirmarOutlier=true con el MISMO sha256 que el primero.
  expect(llamadasFotos.length).toBe(1);
  expect(llamadasPesajes.length).toBe(2);
  expect(llamadasPesajes[0]?.cuerpo.confirmarOutlier).toBeFalsy();
  expect(llamadasPesajes[1]?.cuerpo.confirmarOutlier).toBe(true);
  const shaUno = llamadasPesajes[0]?.cuerpo.fotoSha256;
  const shaDos = llamadasPesajes[1]?.cuerpo.fotoSha256;
  expect(shaUno).toBeTruthy();
  expect(shaUno).toBe(shaDos);
});

test("AC-PES-08: cancelar el outlier no envía nada y deja la pantalla lista para corregir", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // Mismo producto del test anterior (serial, misma base): ya tiene mediana ≈500 g
  // (3×500 g + el pesaje de 5.000 g que sí se confirmó no la mueve — sigue en 500 g).
  await page.goto("/pesar");
  await page.getByRole("button", { name: NOMBRE_PRODUCTO, exact: true }).click();
  await teclear(page, "9"); // otro outlier claro

  await page.getByRole("button", { name: "Confirmar con foto" }).click();
  await expect(page.getByRole("button", { name: "Tomar foto y pesar" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Tomar foto y pesar" }).click();
  await expect(page.getByText(/¿Confirmas 9 kg\?/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Cancelar", exact: true }).click();

  // Vuelve a "listo": nada se manda, y el botón principal reaparece (no "Pesando…").
  await expect(page.getByRole("button", { name: "Confirmar con foto" })).toBeVisible();
  await expect(page.getByText(/¿Confirmas/)).toHaveCount(0);
});
