#!/usr/bin/env node
// Prueba las invariantes de BD intentando violarlas (PROMPT_MAESTRO.md §9: "el gate
// las testea intentando violarlas"). Corre sobre una instancia pglite EN MEMORIA,
// aislada del dato de desarrollo en db/data/pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

async function dbNueva() {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  const dir = join(ROOT, "migraciones");
  for (const archivo of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, archivo), "utf8"));
  }
  // AC-SEC-08: probar por el camino HTTP real = pan_app, NUNCA el superusuario que
  // corrió la migración. Un REVOKE FROM PUBLIC no frena al dueño/superusuario, así
  // que un test que no hace SET ROLE aquí no prueba nada (encontrado escribiendo
  // este mismo archivo — ver 0001_identidad.sql).
  await db.exec("set role pan_app");
  return db;
}

async function crearSesion(db, usuarioId, dispositivoId) {
  await db.query(`insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2)`, [
    dispositivoId,
    usuarioId,
  ]);
}

async function crearProducto(db, nombre = "Marraqueta") {
  const p = await db.query(
    `insert into pan.productos (nombre, tipo_venta) values ($1,'kilo') returning id`,
    [nombre]
  );
  return p.rows[0].id;
}

async function crearHornada(db, productoId, usuarioId, dispositivoId, masaGramos = 25000) {
  const h = await db.query(
    `insert into pan.hornadas (producto_id, masa_gramos, usuario_id, dispositivo_id) values ($1,$2,$3,$4) returning id`,
    [productoId, masaGramos, usuarioId, dispositivoId]
  );
  return h.rows[0].id;
}

async function crearUsuarioYDispositivo(db, rut, rol = "maestro") {
  const u = await db.query(
    `insert into pan.usuarios (nombre, rut, rol, pin_hash) values ($1,$2,$3,'x') returning id`,
    ["Prueba", rut, rol]
  );
  const usuarioId = u.rows[0].id;
  const d = await db.query(
    `insert into pan.dispositivos (nombre, secreto_hash, enrolado_por) values ('Tablet','x',$1) returning id`,
    [usuarioId]
  );
  return { usuarioId, dispositivoId: d.rows[0].id };
}

test("pan.valida_rut acepta RUTs válidos y rechaza inválidos (paridad con TS)", async () => {
  const db = await dbNueva();
  const validos = await db.query(`select pan.valida_rut('12.345.678-5') as ok`);
  assert.equal(validos.rows[0].ok, true);
  const conK = await db.query(`select pan.valida_rut('10.000.013-K') as ok`);
  assert.equal(conK.rows[0].ok, true);
  const invalido = await db.query(`select pan.valida_rut('12.345.678-9') as ok`);
  assert.equal(invalido.rows[0].ok, false);
  await db.close();
});

test("usuarios: CHECK de RUT rebota un RUT con dígito verificador incorrecto", async () => {
  const db = await dbNueva();
  await assert.rejects(
    () =>
      db.query(`insert into pan.usuarios (nombre, rut, rol, pin_hash) values ('X','12.345.678-9','maestro','x')`),
    /violat|constraint|check/i
  );
  await db.close();
});

test("sesiones_operador: EXCLUDE gist rebota dos sesiones abiertas en el MISMO dispositivo", async () => {
  const db = await dbNueva();
  const { usuarioId: u1, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  const { usuarioId: u2 } = await crearUsuarioYDispositivo(db, "76.192.083-9", "vendedor");
  await db.query(`insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2)`, [
    dispositivoId,
    u1,
  ]);
  await assert.rejects(
    () =>
      db.query(`insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2)`, [
        dispositivoId,
        u2,
      ]),
    /exclusion|constraint/i
  );
  await db.close();
});

test("sesiones_operador: usuario que abre sesión en OTRO dispositivo desplaza la anterior + evento de auditoría", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId: d1 } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  const d2 = await db.query(
    `insert into pan.dispositivos (nombre, secreto_hash, enrolado_por) values ('Tablet 2','x',$1) returning id`,
    [usuarioId]
  );
  await db.query(`insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2)`, [
    d1,
    usuarioId,
  ]);
  await db.query(`insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2)`, [
    d2.rows[0].id,
    usuarioId,
  ]);

  const abierta = await db.query(
    `select dispositivo_id from pan.sesiones_operador where usuario_id = $1 and fin is null`,
    [usuarioId]
  );
  assert.equal(abierta.rows.length, 1, "solo debe quedar UNA sesión abierta para el usuario");
  assert.equal(abierta.rows[0].dispositivo_id, d2.rows[0].id);

  const evento = await db.query(
    `select * from pan.eventos where tipo = 'sesion_desplazada' and usuario_id = $1`,
    [usuarioId]
  );
  assert.equal(evento.rows.length, 1, "debe quedar un evento de auditoría de la sesión desplazada");
  await db.close();
});

test("eventos: append-only — UPDATE y DELETE están revocados para public", async () => {
  const db = await dbNueva();
  await db.query(`insert into pan.eventos (tipo, entidad) values ('x','y')`);
  await assert.rejects(() => db.query(`update pan.eventos set tipo = 'z'`), /permission|denied/i);
  await assert.rejects(() => db.query(`delete from pan.eventos`), /permission|denied/i);
  await db.close();
});

test("AC-SEC-01: 5 PIN fallidos bloquean el dispositivo+usuario 15 min, incluso con el PIN correcto después", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");

  for (let i = 0; i < 4; i++) {
    const r = await db.query(`select pan.registrar_intento_pin($1,$2,false) as permitido`, [
      dispositivoId,
      usuarioId,
    ]);
    assert.equal(r.rows[0].permitido, true, `intento fallido #${i + 1} no debería bloquear todavía`);
  }
  const quinto = await db.query(`select pan.registrar_intento_pin($1,$2,false) as permitido`, [
    dispositivoId,
    usuarioId,
  ]);
  assert.equal(quinto.rows[0].permitido, false, "el 5º intento fallido debe bloquear");

  const conPinCorrecto = await db.query(`select pan.registrar_intento_pin($1,$2,true) as permitido`, [
    dispositivoId,
    usuarioId,
  ]);
  assert.equal(
    conPinCorrecto.rows[0].permitido,
    false,
    "bloqueado significa bloqueado — ni el PIN correcto pasa hasta que expire"
  );

  const evento = await db.query(`select * from pan.eventos where tipo = 'pin_bloqueado'`);
  assert.equal(evento.rows.length, 1);
  await db.close();
});

test("AC-SEC-01: un usuario/dispositivo distinto NO se ve afectado por el bloqueo de otro", async () => {
  const db = await dbNueva();
  const { usuarioId: u1, dispositivoId: d1 } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  const { usuarioId: u2, dispositivoId: d2 } = await crearUsuarioYDispositivo(db, "76.192.083-9", "vendedor");

  for (let i = 0; i < 5; i++) {
    await db.query(`select pan.registrar_intento_pin($1,$2,false)`, [d1, u1]);
  }
  const otro = await db.query(`select pan.registrar_intento_pin($1,$2,true) as permitido`, [d2, u2]);
  assert.equal(otro.rows[0].permitido, true, "el bloqueo es por (dispositivo, usuario), no global");
  await db.close();
});

// =============================================================================
// Hito 2 — catálogo y pesaje
// =============================================================================

test("pesajes: destino='reparto' exige pedido_linea_id; destino='mostrador' lo prohíbe", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const hornadaId = await crearHornada(db, productoId, usuarioId, dispositivoId);

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.pesajes (client_uuid, producto_id, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), $1, $2, 1000, 'reparto', $3, $4, now())`,
        [productoId, hornadaId, usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "reparto sin pedido_linea_id debe rebotar"
  );

  // pedido_linea_id ya tiene FK real (agregada en 0004): un uuid inventado rebota,
  // así que el caso feliz necesita una línea de pedido de verdad.
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const linea = await db.query(
    `insert into pan.pedido_lineas (pedido_id, producto_id, gramos_pedidos, precio_clp) values ($1,$2,5000,10000) returning id`,
    [pedidoId, productoId]
  );

  const ok = await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, hornada_id, pedido_linea_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, $2, $3, 1000, 'reparto', $4, $5, now()) returning id`,
    [productoId, hornadaId, linea.rows[0].id, usuarioId, dispositivoId]
  );
  assert.equal(ok.rows.length, 1);
  await db.close();
});

test("pesajes: destino='merma' exige motivo_merma Y estado_merma (AC-MERM-01)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const hornadaId = await crearHornada(db, productoId, usuarioId, dispositivoId);

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.pesajes (client_uuid, producto_id, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), $1, $2, 500, 'merma', $3, $4, now())`,
        [productoId, hornadaId, usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "merma sin motivo NI estado debe rebotar"
  );

  const ok = await db.query(
    `insert into pan.pesajes
       (client_uuid, producto_id, hornada_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, $2, 500, 'merma', 'sobrante_dia', 'pendiente', $3, $4, now()) returning id`,
    [productoId, hornadaId, usuarioId, dispositivoId]
  );
  assert.equal(ok.rows.length, 1);
  await db.close();
});

test("AC-MERM-01: sobrante_dia se resuelve a recuperada_con_venta o confirmada_perdida, no a cualquier cosa", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const hornadaId = await crearHornada(db, productoId, usuarioId, dispositivoId);

  const pesaje = await db.query(
    `insert into pan.pesajes
       (client_uuid, producto_id, hornada_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, $2, 500, 'merma', 'sobrante_dia', 'pendiente', $3, $4, now()) returning id`,
    [productoId, hornadaId, usuarioId, dispositivoId]
  );
  const pesajeId = pesaje.rows[0].id;

  // pan_app SOLO puede tocar estado_merma/venta_recuperada_id (grant column-level) —
  // intentar cambiar gramos por la misma vía debe rebotar.
  await assert.rejects(
    () => db.query(`update pan.pesajes set gramos = 999 where id = $1`, [pesajeId]),
    /permission|denied/i,
    "pan_app no debería poder tocar gramos de un pesaje ya creado"
  );

  const resuelto = await db.query(
    `update pan.pesajes set estado_merma = 'confirmada_perdida' where id = $1 returning estado_merma`,
    [pesajeId]
  );
  assert.equal(resuelto.rows[0].estado_merma, "confirmada_perdida");
  await db.close();
});

test("AC-ID-02: un pesaje sin sesión de operador viva rebota (trigger real, no solo la función suelta)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  const productoId = await crearProducto(db);
  // OJO: sin crearSesion() — a propósito. hornada_id va NULL (válido, "fase 1" del
  // prompt maestro) precisamente para que este test aísle el trigger de pesajes y no
  // se tropiece con el mismo trigger ya cableado en hornadas.

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), $1, 1000, 'mostrador', $2, $3, now())`,
        [productoId, usuarioId, dispositivoId]
      ),
    /sin sesión/i
  );
  await db.close();
});

test("AC-ID-02: una hornada sin sesión de operador viva también rebota", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  const productoId = await crearProducto(db);
  // OJO: sin crearSesion() — a propósito.
  await assert.rejects(() => crearHornada(db, productoId, usuarioId, dispositivoId), /sin sesión/i);
  await db.close();
});

test("pesajes: client_uuid duplicado rebota (idempotencia)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const hornadaId = await crearHornada(db, productoId, usuarioId, dispositivoId);
  const clientUuid = "11111111-1111-4111-8111-111111111111";

  await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values ($1, $2, $3, 1000, 'mostrador', $4, $5, now())`,
    [clientUuid, productoId, hornadaId, usuarioId, dispositivoId]
  );
  await assert.rejects(
    () =>
      db.query(
        `insert into pan.pesajes (client_uuid, producto_id, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values ($1, $2, $3, 1000, 'mostrador', $4, $5, now())`,
        [clientUuid, productoId, hornadaId, usuarioId, dispositivoId]
      ),
    /unique|duplicate/i
  );
  await db.close();
});

test("AC-PES-03: es_outlier_pesaje ignora el pesaje sin historia suficiente (evita falso positivo día 1)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);

  const r = await db.query(`select pan.es_outlier_pesaje($1, 99000) as outlier`, [productoId]);
  assert.equal(r.rows[0].outlier, false, "sin >=3 pesajes previos, nunca debe marcar outlier");
  await db.close();
});

test("pesajes: INSERT...ON CONFLICT DO NOTHING RETURNING funciona bajo pan_app (no requiere UPDATE(client_uuid))", async () => {
  // Regresión: un upsert con DO UPDATE SET client_uuid=... rompía porque pan_app solo
  // tiene UPDATE en (estado_merma, venta_recuperada_id) — a propósito, ver 0002.
  // La API real usa DO NOTHING + SELECT aparte; este test prueba exactamente eso bajo
  // el rol real, no bajo el dueño de la migración.
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const clientUuid = "22222222-2222-4222-8222-222222222222";

  const primero = await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values ($1, $2, 1000, 'mostrador', $3, $4, now())
     on conflict (client_uuid) do nothing returning id`,
    [clientUuid, productoId, usuarioId, dispositivoId]
  );
  assert.equal(primero.rows.length, 1, "el insert original debe devolver la fila");

  const reintento = await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values ($1, $2, 1000, 'mostrador', $3, $4, now())
     on conflict (client_uuid) do nothing returning id`,
    [clientUuid, productoId, usuarioId, dispositivoId]
  );
  assert.equal(reintento.rows.length, 0, "el reintento con el mismo client_uuid no inserta de nuevo");

  const buscado = await db.query(`select id from pan.pesajes where client_uuid = $1`, [clientUuid]);
  assert.equal(buscado.rows.length, 1, "pero sigue siendo consultable por SELECT para recuperar el id");
  await db.close();
});

test("AC-PES-03: es_outlier_pesaje detecta 25.000 g donde iban 2.500 (test centinela #4 del prompt maestro)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const hornadaId = await crearHornada(db, productoId, usuarioId, dispositivoId);

  for (const gramos of [2500, 2400, 2600, 2500]) {
    await db.query(
      `insert into pan.pesajes (client_uuid, producto_id, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
       values (gen_random_uuid(), $1, $2, $3, 'mostrador', $4, $5, now())`,
      [productoId, hornadaId, gramos, usuarioId, dispositivoId]
    );
  }

  const normal = await db.query(`select pan.es_outlier_pesaje($1, 2550) as outlier`, [productoId]);
  assert.equal(normal.rows[0].outlier, false, "2.550 g está en línea con la mediana ~2.500");

  const outlier = await db.query(`select pan.es_outlier_pesaje($1, 25000) as outlier`, [productoId]);
  assert.equal(outlier.rows[0].outlier, true, "25.000 g es >3x la mediana ~2.500 — debe marcar outlier");
  await db.close();
});

// =============================================================================
// Hito 3 — venta mostrador
// =============================================================================

async function pesarMostrador(db, productoId, gramos, usuarioId, dispositivoId) {
  await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, $2, 'mostrador', $3, $4, now())`,
    [productoId, gramos, usuarioId, dispositivoId]
  );
}

test("AC-VEN-02: stock_disponible baja con la venta y nunca queda negativo por una venta que lo excede", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);

  const antes = await db.query(`select pan.stock_disponible($1) as stock`, [productoId]);
  assert.equal(antes.rows[0].stock, 0, "sin pesajes, stock es 0, no null ni error");

  await pesarMostrador(db, productoId, 5000, usuarioId, dispositivoId);
  const conPesaje = await db.query(`select pan.stock_disponible($1) as stock`, [productoId]);
  assert.equal(conPesaje.rows[0].stock, 5000);

  const venta = await db.query(
    `insert into pan.ventas (vendedor_id, dispositivo_id, medio_pago, total_clp) values ($1,$2,'efectivo',2000) returning id`,
    [usuarioId, dispositivoId]
  );
  await db.query(
    `insert into pan.venta_lineas (venta_id, producto_id, gramos, precio_clp) values ($1,$2,2000,2000)`,
    [venta.rows[0].id, productoId]
  );
  const conVenta = await db.query(`select pan.stock_disponible($1) as stock`, [productoId]);
  assert.equal(conVenta.rows[0].stock, 3000, "5000 pesados - 2000 vendidos = 3000 disponibles");
  await db.close();
});

test("ventas: medio_pago='fiado' exige cliente_id; el resto no lo exige", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.ventas (vendedor_id, dispositivo_id, medio_pago, total_clp) values ($1,$2,'fiado',1000)`,
        [usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "fiado sin cliente_id debe rebotar"
  );

  const ok = await db.query(
    `insert into pan.ventas (vendedor_id, dispositivo_id, medio_pago, total_clp) values ($1,$2,'efectivo',1000) returning id`,
    [usuarioId, dispositivoId]
  );
  assert.equal(ok.rows.length, 1, "efectivo sin cliente_id es válido");
  await db.close();
});

test("venta_lineas: exige gramos O unidades, nunca ambos ni ninguno", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const venta = await db.query(
    `insert into pan.ventas (vendedor_id, dispositivo_id, medio_pago, total_clp) values ($1,$2,'efectivo',1000) returning id`,
    [usuarioId, dispositivoId]
  );
  const ventaId = venta.rows[0].id;

  await assert.rejects(
    () =>
      db.query(`insert into pan.venta_lineas (venta_id, producto_id, precio_clp) values ($1,$2,1000)`, [
        ventaId,
        productoId,
      ]),
    /constraint|check/i,
    "ni gramos ni unidades debe rebotar"
  );
  await assert.rejects(
    () =>
      db.query(
        `insert into pan.venta_lineas (venta_id, producto_id, gramos, unidades, precio_clp) values ($1,$2,500,2,1000)`,
        [ventaId, productoId]
      ),
    /constraint|check/i,
    "gramos Y unidades a la vez debe rebotar"
  );
  await db.close();
});

test("medios_pago: pan_app puede desactivar uno (activo) pero no borrarlo ni cambiar su etiqueta", async () => {
  const db = await dbNueva();
  const r = await db.query(`update pan.medios_pago set activo = false where clave = 'otro' returning activo`);
  assert.equal(r.rows[0].activo, false);
  await assert.rejects(
    () => db.query(`update pan.medios_pago set etiqueta = 'x' where clave = 'otro'`),
    /permission|denied/i
  );
  await assert.rejects(() => db.query(`delete from pan.medios_pago where clave = 'otro'`), /permission|denied/i);
  await db.close();
});

// =============================================================================
// Hitos 4/5/6 — despacho, DTE y POD (las invariantes legales)
// =============================================================================

async function crearCliente(db, rut = "76.192.083-9") {
  const c = await db.query(
    `insert into pan.clientes (rut, razon_social, canal, lat, lng) values ($1,'Almacén Prueba','reparto',-33.45,-70.66) returning id`,
    [rut]
  );
  return c.rows[0].id;
}

async function crearPedido(db, clienteId, usuarioId, dispositivoId) {
  const p = await db.query(
    `insert into pan.pedidos (cliente_id, fecha_entrega, usuario_id, dispositivo_id)
     values ($1, current_date, $2, $3) returning id`,
    [clienteId, usuarioId, dispositivoId]
  );
  return p.rows[0].id;
}

async function registrarDte(db, pedidoId, usuarioId, dispositivoId, folio = 1001, tipo = 52) {
  const d = await db.query(
    `insert into pan.documento_tributario
       (tipo_dte, folio_sii, rut_emisor, fecha_emision, monto_total, origen_captura, pedido_id, usuario_id, dispositivo_id)
     values ($1,$2,'76.192.083-9', current_date, 10000, 'manual', $3, $4, $5) returning id`,
    [tipo, folio, pedidoId, usuarioId, dispositivoId]
  );
  return d.rows[0].id;
}

test("AC-DES-01: correlativo_pedido solo lo asigna pan.asignar_correlativo(), y después es inmutable", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);

  const asignado = await db.query(`select pan.asignar_correlativo($1) as correlativo`, [pedidoId]);
  assert.ok(asignado.rows[0].correlativo > 0, "debe devolver un correlativo positivo");

  await assert.rejects(
    () => db.query(`select pan.asignar_correlativo($1)`, [pedidoId]),
    /ya tiene correlativo/i,
    "no se puede reasignar"
  );
  await assert.rejects(
    () => db.query(`update pan.pedidos set correlativo_pedido = 999 where id = $1`, [pedidoId]),
    /inmutable/i,
    "ni un UPDATE directo lo cambia"
  );
  await db.close();
});

test("AC-DES-02 (art. 55 DL 825): una ruta con un pedido SIN DTE no puede pasar a en_curso", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "repartidor");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const ruta = await db.query(
    `insert into pan.rutas (repartidor_id, vehiculo) values ($1,'ABCD12') returning id`,
    [usuarioId]
  );
  const rutaId = ruta.rows[0].id;
  await db.query(`insert into pan.ruta_paradas (ruta_id, pedido_id, orden) values ($1,$2,1)`, [rutaId, pedidoId]);

  await assert.rejects(
    () => db.query(`update pan.rutas set estado = 'en_curso' where id = $1`, [rutaId]),
    /sin DTE asociado/i,
    "sin guía, la ruta NO sale — sin override posible"
  );

  await registrarDte(db, pedidoId, usuarioId, dispositivoId);
  const ok = await db.query(`update pan.rutas set estado = 'en_curso' where id = $1 returning estado`, [rutaId]);
  assert.equal(ok.rows[0].estado, "en_curso", "con la guía registrada, ahora sí sale");
  await db.close();
});

test("AC-DTE-01: (tipo, folio, rut_emisor) es único — el mismo folio no se registra dos veces", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);

  await registrarDte(db, pedidoId, usuarioId, dispositivoId, 5555);
  await assert.rejects(
    () => registrarDte(db, pedidoId, usuarioId, dispositivoId, 5555),
    /unique|duplicate/i
  );
  await db.close();
});

test("AC-DTE-01: neto + IVA deben cuadrar con el total, e ind_traslado solo aplica a guías (52)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.documento_tributario
           (tipo_dte, folio_sii, rut_emisor, fecha_emision, monto_total, monto_neto, monto_iva, origen_captura, usuario_id, dispositivo_id)
         values (33, 7001, '76.192.083-9', current_date, 11900, 10000, 1000, 'manual', $1, $2)`,
        [usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "10000 + 1000 no es 11900 — debe rebotar"
  );

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.documento_tributario
           (tipo_dte, folio_sii, rut_emisor, fecha_emision, monto_total, ind_traslado, origen_captura, usuario_id, dispositivo_id)
         values (33, 7002, '76.192.083-9', current_date, 10000, 1, 'manual', $1, $2)`,
        [usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "ind_traslado en una factura (33) no tiene sentido"
  );
  await db.close();
});

test("AC-FIA-01 (decisión #2): consolidar guías en una factura, y saldo_cliente derivado de eventos", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);

  const pedido1 = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const pedido2 = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const guia1 = await registrarDte(db, pedido1, usuarioId, dispositivoId, 1001, 52);
  const guia2 = await registrarDte(db, pedido2, usuarioId, dispositivoId, 1002, 52);

  const saldoAntes = await db.query(`select saldo_pendiente_clp from pan.saldo_cliente where cliente_id = $1`, [
    clienteId,
  ]);
  assert.equal(saldoAntes.rows[0].saldo_pendiente_clp, 20000, "dos guías de 10.000 cada una");

  // La factura que las agrupa (misma vía SII de siempre: la app solo registra su folio)
  const factura = await registrarDte(db, pedido1, usuarioId, dispositivoId, 9001, 33);
  await db.query(`update pan.documento_tributario set consolidado_en_id = $1 where id in ($2,$3)`, [
    factura,
    guia1,
    guia2,
  ]);

  const consolidadas = await db.query(
    `select count(*)::int as n from pan.documento_tributario where consolidado_en_id = $1`,
    [factura]
  );
  assert.equal(consolidadas.rows[0].n, 2, "ambas guías quedan enlazadas a la misma factura");

  await db.query(`update pan.documento_tributario set estado_pago = 'pagada' where id = $1`, [factura]);
  const facturaPagada = await db.query(`select estado_pago from pan.documento_tributario where id = $1`, [factura]);
  assert.equal(facturaPagada.rows[0].estado_pago, "pagada");
  await db.close();
});

test("AC-DTE-02: pan_app NO puede reescribir un folio ni un RUT ya registrado", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const dteId = await registrarDte(db, pedidoId, usuarioId, dispositivoId);

  await assert.rejects(
    () => db.query(`update pan.documento_tributario set folio_sii = 9999 where id = $1`, [dteId]),
    /permission|denied/i,
    "un folio del SII jamás se reescribe desde la app"
  );
  await assert.rejects(
    () => db.query(`update pan.documento_tributario set rut_emisor = '12.345.678-5' where id = $1`, [dteId]),
    /permission|denied/i
  );
  await db.close();
});

test("AC-POD-01: GPS fuera del rango de Chile (incluido 0,0) rebota EN LA BD", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "repartidor");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.entregas (client_uuid, pedido_id, receptor_nombre, foto_sha256, lat, lng, precision_m, gramos_entregados, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), $1, 'Juan', 'abc', 0, 0, 10, 1000, $2, $3, now())`,
        [pedidoId, usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "(0,0) es el clásico GPS basura — debe rebotar en la BD, no en la UI"
  );
  await db.close();
});

test("AC-POD-01: precisión mala JAMÁS bloquea (solo marca flag) — el pan no espera", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "repartidor");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);

  const ok = await db.query(
    `insert into pan.entregas (client_uuid, pedido_id, receptor_nombre, foto_sha256, lat, lng, precision_m, gps_degradado, gramos_entregados, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 'Juan', 'abc', -33.45, -70.66, 850, true, 1000, $2, $3, now()) returning gps_degradado`,
    [pedidoId, usuarioId, dispositivoId]
  );
  assert.equal(ok.rows[0].gps_degradado, true, "850 m de precisión entra igual, marcada para revisar");
  await db.close();
});

test("AC-POD-01: una entrega cerrada es inmutable — no se edita ni se borra, se supersede", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "repartidor");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);

  const entrega = await db.query(
    `insert into pan.entregas (client_uuid, pedido_id, receptor_nombre, foto_sha256, lat, lng, precision_m, gramos_entregados, cerrada, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 'Juan', 'abc', -33.45, -70.66, 20, 1000, true, $2, $3, now()) returning id`,
    [pedidoId, usuarioId, dispositivoId]
  );
  const entregaId = entrega.rows[0].id;

  await assert.rejects(
    () => db.query(`update pan.entregas set receptor_nombre = 'Otro' where id = $1`, [entregaId]),
    /permission|denied|cerrada/i,
    "editar el receptor de un POD cerrado debe rebotar"
  );
  await assert.rejects(
    () => db.query(`delete from pan.entregas where id = $1`, [entregaId]),
    /permission|denied|jamás se borra/i,
    "un POD jamás se borra: es evidencia"
  );

  // La corrección legítima: fila NUEVA que supersede a la anterior.
  const correccion = await db.query(
    `insert into pan.entregas (client_uuid, pedido_id, supersede_id, receptor_nombre, foto_sha256, lat, lng, precision_m, gramos_entregados, cerrada, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, $2, 'Juan Pérez (corregido)', 'abc', -33.45, -70.66, 20, 1000, true, $3, $4, now()) returning id`,
    [pedidoId, entregaId, usuarioId, dispositivoId]
  );
  assert.equal(correccion.rows.length, 1, "corregir = insertar otra fila con supersede_id");
  await db.close();
});

test("AC-POD-01: un segundo POD vigente para el MISMO pedido rebota (índice parcial)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "repartidor");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);

  const insertar = () =>
    db.query(
      `insert into pan.entregas (client_uuid, pedido_id, receptor_nombre, foto_sha256, lat, lng, precision_m, gramos_entregados, cerrada, usuario_id, dispositivo_id, capturado_at)
       values (gen_random_uuid(), $1, 'Juan', 'abc', -33.45, -70.66, 20, 1000, true, $2, $3, now())`,
      [pedidoId, usuarioId, dispositivoId]
    );
  await insertar();
  await assert.rejects(insertar(), /unique|duplicate/i, "dos entregas vigentes del mismo pedido: imposible");
  await db.close();
});

test("AC-POD-02: replay del mismo client_uuid no duplica la entrega (test centinela #1)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "repartidor");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const clientUuid = "33333333-3333-4333-8333-333333333333";

  const enviar = () =>
    db.query(
      `insert into pan.entregas (client_uuid, pedido_id, receptor_nombre, foto_sha256, lat, lng, precision_m, gramos_entregados, usuario_id, dispositivo_id, capturado_at)
       values ($1, $2, 'Juan', 'abc', -33.45, -70.66, 20, 1000, $3, $4, now())
       on conflict (client_uuid) do nothing`,
      [clientUuid, pedidoId, usuarioId, dispositivoId]
    );
  await enviar();
  await enviar();
  await enviar();

  const n = await db.query(`select count(*)::int as n from pan.entregas where client_uuid = $1`, [clientUuid]);
  assert.equal(n.rows[0].n, 1, "tres replays de la cola offline = UNA sola entrega");
  await db.close();
});

// =============================================================================
// AC-ID-06 / AC-ID-05 — cambio de operador y auto-bloqueo
// =============================================================================

test("AC-ID-06: el vendedor puede tomar la tablet que dejó abierta el maestro (relevo auditado)", async () => {
  // Regresión de un bug real: el EXCLUDE impedía la segunda sesión y el login
  // devolvía 500 — o sea, el cambio de operador en equipo compartido no funcionaba.
  const db = await dbNueva();
  const { usuarioId: maestro, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5", "maestro");
  const { usuarioId: vendedor } = await crearUsuarioYDispositivo(db, "10.000.013-K", "vendedor");

  const s1 = await db.query(`select pan.abrir_sesion($1,$2) as id`, [dispositivoId, maestro]);
  assert.ok(s1.rows[0].id, "el maestro abre sesión");

  const s2 = await db.query(`select pan.abrir_sesion($1,$2) as id`, [dispositivoId, vendedor]);
  assert.ok(s2.rows[0].id, "el vendedor releva sin que rebote el EXCLUDE");

  const abiertas = await db.query(
    `select usuario_id from pan.sesiones_operador where dispositivo_id = $1 and fin is null`,
    [dispositivoId]
  );
  assert.equal(abiertas.rows.length, 1, "solo UNA sesión abierta por equipo");
  assert.equal(abiertas.rows[0].usuario_id, vendedor);

  const evento = await db.query(`select payload from pan.eventos where tipo = 'operador_relevado'`);
  assert.equal(evento.rows.length, 1, "el relevo queda auditado");
  assert.equal(evento.rows[0].payload.usuario_saliente, maestro);
  assert.equal(evento.rows[0].payload.usuario_entrante, vendedor);
  await db.close();
});

test("AC-ID-05: una sesión inactiva más de 10 min se considera expirada", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  const s = await db.query(`select pan.abrir_sesion($1,$2) as id`, [dispositivoId, usuarioId]);
  const sesionId = s.rows[0].id;

  const recien = await db.query(`select pan.sesion_expirada($1, 10) as expirada`, [sesionId]);
  assert.equal(recien.rows[0].expirada, false, "recién abierta no expira");

  // Envejecer la sesión 11 minutos (el trigger de negocio no toca ultima_actividad).
  await db.exec(`set role postgres`);
  await db.query(`update pan.sesiones_operador set ultima_actividad = now() - interval '11 minutes' where id = $1`, [
    sesionId,
  ]);
  await db.exec(`set role pan_app`);

  const vieja = await db.query(`select pan.sesion_expirada($1, 10) as expirada`, [sesionId]);
  assert.equal(vieja.rows[0].expirada, true, "11 min sin actividad ⇒ expirada");

  const inexistente = await db.query(`select pan.sesion_expirada(gen_random_uuid(), 10) as expirada`);
  assert.equal(inexistente.rows[0].expirada, true, "una sesión que no existe se trata como expirada, nunca como válida");
  await db.close();
});

// =============================================================================
// Hito 7 — TCK (la variable norte)
// =============================================================================

test("AC-DASH-01: TCK = 100% cuando todo lo pesado queda conciliado (vendido + merma tipificada)", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);

  // Pesados 10.000 g: 8.000 a mostrador, 2.000 a merma (quemado).
  await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 8000, 'mostrador', $2, $3, now())`,
    [productoId, usuarioId, dispositivoId]
  );
  await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 2000, 'merma', 'quemado', 'confirmada_perdida', $2, $3, now())`,
    [productoId, usuarioId, dispositivoId]
  );

  const parcial = await db.query(`select tck, g_pesados from pan.conciliacion_diaria where fecha = current_date`);
  assert.equal(Number(parcial.rows[0].g_pesados), 10000);
  assert.equal(Number(parcial.rows[0].tck), 0.2, "solo la merma está conciliada todavía: 2000/10000");

  // Se venden los 8.000 pesados a mostrador.
  const venta = await db.query(
    `insert into pan.ventas (vendedor_id, dispositivo_id, medio_pago, total_clp) values ($1,$2,'efectivo',17520) returning id`,
    [usuarioId, dispositivoId]
  );
  await db.query(
    `insert into pan.venta_lineas (venta_id, producto_id, gramos, precio_clp) values ($1,$2,8000,17520)`,
    [venta.rows[0].id, productoId]
  );

  const total = await db.query(`select tck from pan.conciliacion_diaria where fecha = current_date`);
  assert.equal(Number(total.rows[0].tck), 1, "8000 vendidos + 2000 merma = 10000 pesados => TCK 100%");
  await db.close();
});

test("AC-MERM-01 cerrado: una merma recuperada con venta cuenta como venta, no como pérdida", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);

  const pesaje = await db.query(
    `insert into pan.pesajes (client_uuid, producto_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 3000, 'merma', 'sobrante_dia', 'pendiente', $2, $3, now()) returning id`,
    [productoId, usuarioId, dispositivoId]
  );

  const comoPerdida = await db.query(
    `select g_merma_tipificada, g_venta, g_merma_recuperada from pan.conciliacion_diaria where fecha = current_date`
  );
  assert.equal(Number(comoPerdida.rows[0].g_merma_tipificada), 3000, "pendiente cuenta como merma");
  assert.equal(Number(comoPerdida.rows[0].g_venta), 0);

  // Al día siguiente se vende con descuento: deja de ser pérdida.
  await db.query(`update pan.pesajes set estado_merma = 'recuperada_con_venta' where id = $1`, [
    pesaje.rows[0].id,
  ]);

  const recuperada = await db.query(
    `select g_merma_tipificada, g_venta, g_merma_recuperada, tck from pan.conciliacion_diaria where fecha = current_date`
  );
  assert.equal(Number(recuperada.rows[0].g_merma_tipificada), 0, "ya no se cuenta como merma perdida");
  assert.equal(Number(recuperada.rows[0].g_venta), 3000, "ahora cuenta como venta");
  assert.equal(Number(recuperada.rows[0].g_merma_recuperada), 3000, "y queda visible por separado para el dueño");
  assert.equal(Number(recuperada.rows[0].tck), 1, "la TCK sigue cerrando al 100% — la fórmula no cambió");
  await db.close();
});

test("AC-DASH-01: la TCK NO se puede escribir a mano — es una vista derivada de eventos", async () => {
  const db = await dbNueva();
  await assert.rejects(
    () => db.query(`insert into pan.conciliacion_diaria (fecha, g_pesados) values (current_date, 999)`),
    /cannot insert|no puede|error/i,
    "una vista sin trigger de INSERT no acepta escritura: la TCK jamás se 'arregla' a mano"
  );
  await db.close();
});

test("AC-DASH-02/03: los leads exigen consentimiento explícito, e-auto y KiloRuta por igual", async () => {
  const db = await dbNueva();
  await assert.rejects(
    () =>
      db.query(
        `insert into pan.lead_eauto (km_mes, ahorro_estimado_clp, contacto, consentimiento) values (800, 84000, 'x@y.cl', false)`
      ),
    /constraint|check/i
  );
  await assert.rejects(
    () =>
      db.query(
        `insert into pan.lead_kiloruta (km_mes, paradas_mes, contacto, consentimiento) values (800, 120, 'x@y.cl', false)`
      ),
    /constraint|check/i
  );
  const ok = await db.query(
    `insert into pan.lead_kiloruta (km_mes, paradas_mes, contacto, consentimiento) values (800, 120, 'x@y.cl', true) returning id`
  );
  assert.equal(ok.rows.length, 1);
  await db.close();
});

test("AC-DES-01: gramos_pesados de una línea lo mantiene la BD sumando pesajes, no la app", async () => {
  const db = await dbNueva();
  const { usuarioId, dispositivoId } = await crearUsuarioYDispositivo(db, "12.345.678-5");
  await crearSesion(db, usuarioId, dispositivoId);
  const clienteId = await crearCliente(db);
  const pedidoId = await crearPedido(db, clienteId, usuarioId, dispositivoId);
  const productoId = await crearProducto(db);
  const linea = await db.query(
    `insert into pan.pedido_lineas (pedido_id, producto_id, gramos_pedidos, precio_clp) values ($1,$2,5000,10000) returning id`,
    [pedidoId, productoId]
  );
  const lineaId = linea.rows[0].id;

  for (const gramos of [2000, 1500]) {
    await db.query(
      `insert into pan.pesajes (client_uuid, producto_id, pedido_linea_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
       values (gen_random_uuid(), $1, $2, $3, 'reparto', $4, $5, now())`,
      [productoId, lineaId, gramos, usuarioId, dispositivoId]
    );
  }

  const r = await db.query(`select gramos_pesados from pan.pedido_lineas where id = $1`, [lineaId]);
  assert.equal(r.rows[0].gramos_pesados, 3500, "2000 + 1500 sumados por el trigger, no por la aplicación");
  await db.close();
});

