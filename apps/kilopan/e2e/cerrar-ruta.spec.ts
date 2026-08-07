import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-ADM-07 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): cerrar una ruta
// con odómetro desde /arreglar exige un motivo escrito y no vacío, y deja su evento
// (AC-ADM-10). Se ataca la ruta real por HTTP con sesión de verdad (login por pantalla):
// arma una ruta propia con `POST /api/rutas` —GET la expone con su id, a diferencia del
// cierre de caja de AC-ADM-06— y la cierra por HTTP; un doble-tap sobre la MISMA ruta
// rebota en vez de pisar el odómetro ya registrado.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
  cliente: { id: string; razonSocial: string };
};

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02) —
// ver camino-dorado.spec.ts para el detalle. .44/.45/.46/.47 ya las usan
// seguridad-arreglar, anular-venta, corregir-cierre-turno y administracion-productos.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.48" } });

test("AC-ADM-07: cerrar una ruta exige motivo, deja su evento, y un doble-tap rebota", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // Ruta propia del test: un pedido confirmado con su DTE (art. 55 DL 825 no aplica acá
  // —el trigger solo mira la transición a 'en_curso'— pero armar la ruta sí exige un
  // pedido 'confirmado', que POST /api/pedidos deja así de una). Repartidor: el admin
  // mismo — rutas_una_activa_por_repartidor_dia (0011) es por repartidor y el admin no
  // tiene ruta propia sembrada en ningún otro e2e, así que no hace falta sumar un
  // usuario nuevo a preparar-base.mjs solo para este test.
  const fechaEntrega = new Date().toISOString().slice(0, 10);
  const pedido = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 5000 }],
    },
  });
  expect(pedido.ok()).toBeTruthy();
  const { id: pedidoId } = (await pedido.json()) as { id: string };

  const ruta = await page.request.post("/api/rutas", {
    data: { repartidorId: datos.usuarios.admin!.id, pedidoIds: [pedidoId] },
  });
  if (!ruta.ok()) throw new Error(`POST /api/rutas ${ruta.status()}: ${await ruta.text()}`);
  const { id: rutaId } = (await ruta.json()) as { id: string };

  // Sin motivo escrito no se cierra: la confirmación es escribir el porqué, no marcar
  // una casilla (regla transversal de la sección). El servidor rebota 400 antes de
  // siquiera tocar la ruta.
  const sinMotivo = await page.request.post("/api/rutas/cerrar", {
    data: { rutaId, kmFin: 120, motivo: "   " },
  });
  expect(sinMotivo.status()).toBe(400);

  // Un id inventado no existe.
  const inexistente = await page.request.post("/api/rutas/cerrar", {
    data: { rutaId: crypto.randomUUID(), kmFin: 120, motivo: "prueba" },
  });
  expect(inexistente.status()).toBe(404);

  // Camino feliz: cierra con odómetro y motivo.
  const cierre = await page.request.post("/api/rutas/cerrar", {
    data: { rutaId, kmInicio: 80, kmFin: 132, motivo: "quedó abierta por olvido del repartidor" },
  });
  expect(cierre.ok()).toBeTruthy();
  const cuerpoCierre = (await cierre.json()) as { ok: boolean; id: string };
  expect(cuerpoCierre.id).toBe(rutaId);

  // El GET admin de rutas de hoy confirma el odómetro guardado y el estado.
  const listado = await page.request.get("/api/rutas");
  expect(listado.ok()).toBeTruthy();
  const { rutas } = (await listado.json()) as {
    rutas: { id: string; estado: string; km_inicio: number; km_fin: number }[];
  };
  const cerrada = rutas.find((r) => r.id === rutaId);
  expect(cerrada?.estado).toBe("cerrada");
  expect(cerrada?.km_inicio).toBe(80);
  expect(cerrada?.km_fin).toBe(132);

  // Doble-tap sobre la MISMA ruta: ya está cerrada, no se pisa el odómetro que acaba de
  // quedar registrado.
  const dobleTap = await page.request.post("/api/rutas/cerrar", {
    data: { rutaId, kmInicio: 0, kmFin: 999, motivo: "segundo intento" },
  });
  expect(dobleTap.status()).toBe(409);
});

test("AC-ADM-07: un vendedor NO puede cerrar una ruta — el servidor lo rebota con 403", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);
  // El rechazo por rol lo decide el servidor antes de tocar la ruta: un rutaId
  // cualquiera basta, no llega a mirarlo. Esconder el botón en la UI sería teatro
  // (AC-ADM-04).
  const r = await page.request.post("/api/rutas/cerrar", {
    data: { rutaId: crypto.randomUUID(), kmFin: 10, motivo: "no debería poder" },
  });
  expect(r.status()).toBe(403);
});
