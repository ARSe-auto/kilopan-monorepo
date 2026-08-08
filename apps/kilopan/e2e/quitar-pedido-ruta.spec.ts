import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-ADM-09 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): quitar un pedido
// de una ruta desde /arreglar, con motivo escrito y su evento. Migración 0025
// (`pan.ruta_paradas.estado` gana 'quitada' — nunca 'rechazada', que es la reservada
// para un rechazo REAL del cliente en el POD, catálogo cerrado de AC-POD-05; y nunca un
// DELETE, porque `pan.ruta_paradas` no tiene ese grant, 0004).
//
// Se identifica por (rutaId, pedidoId): no existe ningún GET que exponga
// `ruta_paradas.id` por HTTP (mismo patrón que AC-ADM-06 con el id del cierre de turno).
// Repartidor y pedido PROPIOS del test — nunca los del camino dorado ni de otro spec —
// para no chocar con `rutas_una_activa_por_repartidor_dia` (0011).
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
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.68" } });

test("AC-ADM-09: quitar un pedido de una ruta exige motivo, lo saca de la vista del repartidor, y el pedido puede rearmarse", async ({
  page,
  request,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // Repartidor propio, PIN conocido para poder loguearlo de verdad y comprobar qué ve.
  const altaRepartidor = await page.request.post("/api/usuarios", {
    data: { nombre: "Repartidor ADM-09", rut: "55.555.555-5", rol: "repartidor", pin: "1111" },
  });
  expect(altaRepartidor.ok()).toBeTruthy();
  const { id: repartidorId } = (await altaRepartidor.json()) as { id: string };

  const fechaEntrega = new Date().toISOString().slice(0, 10);
  const pedido = await page.request.post("/api/pedidos", {
    data: {
      clienteId: datos.cliente.id,
      fechaEntrega,
      lineas: [{ productoId: datos.productos.Marraqueta, gramosPedidos: 3000 }],
    },
  });
  expect(pedido.ok()).toBeTruthy();
  const { id: pedidoId } = (await pedido.json()) as { id: string };

  const ruta = await page.request.post("/api/rutas", {
    data: { repartidorId, vehiculo: "ADM-09", pedidoIds: [pedidoId] },
  });
  expect(ruta.ok()).toBeTruthy();
  const { id: rutaId } = (await ruta.json()) as { id: string };

  // Sin motivo escrito no se quita: la confirmación es escribir el porqué, no marcar
  // una casilla (regla transversal de la sección).
  const sinMotivo = await page.request.post("/api/rutas/paradas/quitar", {
    data: { rutaId, pedidoId, motivo: "   " },
  });
  expect(sinMotivo.status()).toBe(400);

  // Un par (ruta, pedido) que no corresponde a ninguna parada real.
  const noExiste = await page.request.post("/api/rutas/paradas/quitar", {
    data: { rutaId, pedidoId: crypto.randomUUID(), motivo: "prueba" },
  });
  expect(noExiste.status()).toBe(404);

  // Camino feliz: se quita con motivo.
  const quitar = await page.request.post("/api/rutas/paradas/quitar", {
    data: { rutaId, pedidoId, motivo: "se armó en la ruta equivocada por error" },
  });
  expect(quitar.ok()).toBeTruthy();

  // Doble-tap: ya no está pendiente, no se puede volver a quitar.
  const dobleTap = await page.request.post("/api/rutas/paradas/quitar", {
    data: { rutaId, pedidoId, motivo: "segundo intento" },
  });
  expect(dobleTap.status()).toBe(409);

  // El repartidor deja de verla — equipo desechable propio: loguearlo en el mismo
  // dispositivo que usa `page` para el admin desplazaría esa sesión (relevo atómico de
  // AC-ID-06, mismo motivo que revocar-equipo.spec.ts).
  const enrolado = await page.request.post("/api/dispositivos/enrolar", {
    data: {
      nombreDispositivo: "Tablet desechable ADM-09",
      rutAdmin: datos.usuarios.admin!.rut,
      pinAdmin: datos.pin,
    },
  });
  expect(enrolado.ok()).toBeTruthy();
  const { dispositivoId, secreto } = (await enrolado.json()) as { dispositivoId: string; secreto: string };
  const loginRepartidor = await request.post("/api/auth/login", {
    data: { rut: "55.555.555-5", pin: "1111", dispositivoId, dispositivoSecreto: secreto },
  });
  expect(loginRepartidor.ok()).toBeTruthy();

  const miRuta = await request.get("/api/rutas/mi-ruta");
  expect(miRuta.ok()).toBeTruthy();
  const { paradas } = (await miRuta.json()) as { paradas: { pedido_id: string }[] };
  expect(paradas.some((p) => p.pedido_id === pedidoId)).toBe(false);

  // El pedido volvió a 'confirmado' (mismo destino que una entrega fallida) — se puede
  // rearmar en OTRA ruta. Un segundo repartidor propio, libre de la ruta ya armada.
  const altaRepartidor2 = await page.request.post("/api/usuarios", {
    data: { nombre: "Repartidor ADM-09 bis", rut: "66.777.777-1", rol: "repartidor", pin: "1111" },
  });
  expect(altaRepartidor2.ok()).toBeTruthy();
  const { id: repartidorId2 } = (await altaRepartidor2.json()) as { id: string };
  const rutaNueva = await page.request.post("/api/rutas", {
    data: { repartidorId: repartidorId2, vehiculo: "ADM-09-bis", pedidoIds: [pedidoId] },
  });
  expect(rutaNueva.ok()).toBeTruthy();
  const cuerpoRutaNueva = (await rutaNueva.json()) as { paradas: number };
  expect(cuerpoRutaNueva.paradas).toBe(1);
});

test("AC-ADM-09: un vendedor NO puede quitar un pedido de una ruta — el servidor rebota 403", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);

  const r = await page.request.post("/api/rutas/paradas/quitar", {
    data: { rutaId: crypto.randomUUID(), pedidoId: crypto.randomUUID(), motivo: "no debería poder" },
  });
  expect(r.status()).toBe(403);
});
