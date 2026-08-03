// AC-DASH-08
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { obtenerDb } from "../src/comun/db.ts";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";

// AC-DASH-08: cola de entregas rechazadas/parciales/GPS fuera de zona en el dashboard.
// Flujo: repartidor entrega con rechazo, entrega parcial y GPS fuera de zona, luego
// el admin entra al dashboard y ve los tres en la cola «Entregas por revisar».

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

test.describe.configure({ mode: "serial" });
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.11" } });

async function ingresar(page: Page, rol: keyof typeof datos.usuarios) {
  const rut = datos.usuarios[rol]!.rut;
  await page.goto("/ingresar");

  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(rut);
    await expect(campoRut).toHaveValue(rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  const pin = datos.pin;
  for (const caracter of pin) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }

  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/ingresar/, { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
});

test("cola de entregas por revisar muestra rechazadas, parciales y GPS fuera de zona", async ({
  page,
}) => {
  const db = await obtenerDb();

  // Preparar tres entregas de prueba: una rechazada, una parcial, una con GPS fuera de zona.
  // El repartidor las sincroniza desde offline.
  const admin = datos.usuarios.admin;
  const repartidor = datos.usuarios.repartidor;
  const cliente = datos.cliente;
  const producto = Object.values(datos.productos)[0];

  // Crear tres pedidos distintos.
  const pedido1 = await db.query<{ id: string }>(
    `insert into pan.pedidos (cliente_id, fecha_entrega, usuario_id, dispositivo_id)
     values ($1, current_date, $2, $3)
     returning id`,
    [cliente.id, admin.id, datos.dispositivo.id]
  );
  const pedidoId1 = pedido1.rows[0].id;

  const pedido2 = await db.query<{ id: string }>(
    `insert into pan.pedidos (cliente_id, fecha_entrega, usuario_id, dispositivo_id)
     values ($1, current_date, $2, $3)
     returning id`,
    [cliente.id, admin.id, datos.dispositivo.id]
  );
  const pedidoId2 = pedido2.rows[0].id;

  const pedido3 = await db.query<{ id: string }>(
    `insert into pan.pedidos (cliente_id, fecha_entrega, usuario_id, dispositivo_id)
     values ($1, current_date, $2, $3)
     returning id`,
    [cliente.id, admin.id, datos.dispositivo.id]
  );
  const pedidoId3 = pedido3.rows[0].id;

  // Agregar líneas de pedido a cada uno.
  const gramosTest = 1000;
  for (const pedidoId of [pedidoId1, pedidoId2, pedidoId3]) {
    await db.query(
      `insert into pan.pedido_lineas (pedido_id, producto_id, gramos_pedidos, precio_clp)
       values ($1, $2, $3, 500)`,
      [pedidoId, producto, gramosTest]
    );
  }

  // Confirmar los tres pedidos.
  for (const pedidoId of [pedidoId1, pedidoId2, pedidoId3]) {
    await db.query(`select pan.asignar_correlativo($1)`, [pedidoId]);
    await db.query(`update pan.pedidos set estado = 'en_ruta' where id = $1`, [pedidoId]);
  }

  // Crear ruta al repartidor y agregar los pedidos como paradas.
  const ruta = await db.query<{ id: string }>(
    `insert into pan.rutas (fecha, repartidor_id, estado)
     values (current_date, $1, 'en_curso')
     returning id`,
    [repartidor.id]
  );
  const rutaId = ruta.rows[0].id;

  const paradas = [];
  for (let i = 0; i < 3; i++) {
    const parada = await db.query<{ id: string }>(
      `insert into pan.ruta_paradas (ruta_id, pedido_id, orden)
       values ($1, $2, $3)
       returning id`,
      [rutaId, [pedidoId1, pedidoId2, pedidoId3][i], i + 1]
    );
    paradas.push(parada.rows[0].id);
  }

  // Simular sincronización de entregas offline desde el repartidor.
  // 1. Entrega rechazada: sin GPS, con motivo de rechazo.
  const syncRechazada = {
    entregas: [
      {
        clientUuid: "uuid-rechazada-001",
        pedidoId: pedidoId1,
        receptorNombre: "Recepcionista",
        fotoSha256: "abcd1234",
        gramosEntregados: 0,
        motivoRechazo: "Puerta cerrada",
        capturadoAt: new Date().toISOString(),
      },
    ],
  };
  const respRechazada = await page.request.post("/api/sync", {
    data: syncRechazada,
    headers: { Authorization: `Bearer ${datos.dispositivo.secreto}` },
  });
  expect(respRechazada.ok()).toBeTruthy();

  // 2. Entrega parcial: se entregaron 300 g de 1000 g pedidos.
  const syncParcial = {
    entregas: [
      {
        clientUuid: "uuid-parcial-001",
        pedidoId: pedidoId2,
        receptorNombre: "Recepcionista",
        fotoSha256: "efgh5678",
        gramosEntregados: 300,
        lat: -33.445678,
        lng: -70.667890,
        precisionM: 50,
        capturadoAt: new Date().toISOString(),
      },
    ],
  };
  const respParcial = await page.request.post("/api/sync", {
    data: syncParcial,
    headers: { Authorization: `Bearer ${datos.dispositivo.secreto}` },
  });
  expect(respParcial.ok()).toBeTruthy();

  // 3. Entrega con GPS fuera de zona (>300 m del cliente).
  const syncFueraZona = {
    entregas: [
      {
        clientUuid: "uuid-fuera-001",
        pedidoId: pedidoId3,
        receptorNombre: "Recepcionista",
        fotoSha256: "ijkl9012",
        gramosEntregados: 1000,
        lat: -33.2,
        lng: -70.2,
        precisionM: 50,
        capturadoAt: new Date().toISOString(),
      },
    ],
  };
  const respFuera = await page.request.post("/api/sync", {
    data: syncFueraZona,
    headers: { Authorization: `Bearer ${datos.dispositivo.secreto}` },
  });
  expect(respFuera.ok()).toBeTruthy();

  // Ahora el admin accede al dashboard.
  await ingresar(page, "admin");
  await page.goto("/dashboard");

  // Verificar que la cola de entregas aparece.
  await expect(page.getByRole("heading", { name: "Entregas por revisar" })).toBeVisible();

  // Verificar que muestra las 3 entregas.
  const textoEnColaPorRevisar = await page.locator('section:has-text("Entregas por revisar")').textContent();
  expect(textoEnColaPorRevisar).toContain("3 entregas");

  // Verificar que aparecen los tres clientes (mismo cliente en los tres, pero se ven 3 tarjetas).
  const tarjetas = page.locator('section:has-text("Entregas por revisar") > div > div');
  await expect(tarjetas).toHaveCount(3);

  // Verificar que aparece el estado de rechazada.
  const tarjeta1 = tarjetas.nth(0);
  await expect(tarjeta1).toContainText("Rechazada");
  await expect(tarjeta1).toContainText("Puerta cerrada");

  // Verificar que aparece el estado de parcial con kg.
  const tarjeta2 = tarjetas.nth(1);
  await expect(tarjeta2).toContainText("Parcial");
  await expect(tarjeta2).toContainText("Entregados:");

  // Verificar que aparece GPS fuera de zona.
  const tarjeta3 = tarjetas.nth(2);
  await expect(tarjeta3).toContainText("GPS fuera de zona");
  await expect(tarjeta3).toContainText("más de 300 m");
});
