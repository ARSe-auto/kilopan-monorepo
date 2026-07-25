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
        `insert into pan.pesajes (client_uuid, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), $1, 1000, 'reparto', $2, $3, now())`,
        [hornadaId, usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "reparto sin pedido_linea_id debe rebotar"
  );

  const ok = await db.query(
    `insert into pan.pesajes (client_uuid, hornada_id, pedido_linea_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, gen_random_uuid(), 1000, 'reparto', $2, $3, now()) returning id`,
    [hornadaId, usuarioId, dispositivoId]
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
        `insert into pan.pesajes (client_uuid, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), $1, 500, 'merma', $2, $3, now())`,
        [hornadaId, usuarioId, dispositivoId]
      ),
    /constraint|check/i,
    "merma sin motivo NI estado debe rebotar"
  );

  const ok = await db.query(
    `insert into pan.pesajes
       (client_uuid, hornada_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 500, 'merma', 'sobrante_dia', 'pendiente', $2, $3, now()) returning id`,
    [hornadaId, usuarioId, dispositivoId]
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
       (client_uuid, hornada_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
     values (gen_random_uuid(), $1, 500, 'merma', 'sobrante_dia', 'pendiente', $2, $3, now()) returning id`,
    [hornadaId, usuarioId, dispositivoId]
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
  // OJO: sin crearSesion() — a propósito. hornada_id va NULL (válido, "fase 1" del
  // prompt maestro) precisamente para que este test aísle el trigger de pesajes y no
  // se tropiece con el mismo trigger ya cableado en hornadas.

  await assert.rejects(
    () =>
      db.query(
        `insert into pan.pesajes (client_uuid, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values (gen_random_uuid(), 1000, 'mostrador', $1, $2, now())`,
        [usuarioId, dispositivoId]
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
    `insert into pan.pesajes (client_uuid, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values ($1, $2, 1000, 'mostrador', $3, $4, now())`,
    [clientUuid, hornadaId, usuarioId, dispositivoId]
  );
  await assert.rejects(
    () =>
      db.query(
        `insert into pan.pesajes (client_uuid, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
         values ($1, $2, 1000, 'mostrador', $3, $4, now())`,
        [clientUuid, hornadaId, usuarioId, dispositivoId]
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
  const clientUuid = "22222222-2222-4222-8222-222222222222";

  const primero = await db.query(
    `insert into pan.pesajes (client_uuid, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values ($1, 1000, 'mostrador', $2, $3, now())
     on conflict (client_uuid) do nothing returning id`,
    [clientUuid, usuarioId, dispositivoId]
  );
  assert.equal(primero.rows.length, 1, "el insert original debe devolver la fila");

  const reintento = await db.query(
    `insert into pan.pesajes (client_uuid, gramos, destino, usuario_id, dispositivo_id, capturado_at)
     values ($1, 1000, 'mostrador', $2, $3, now())
     on conflict (client_uuid) do nothing returning id`,
    [clientUuid, usuarioId, dispositivoId]
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
      `insert into pan.pesajes (client_uuid, hornada_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
       values (gen_random_uuid(), $1, $2, 'mostrador', $3, $4, now())`,
      [hornadaId, gramos, usuarioId, dispositivoId]
    );
  }

  const normal = await db.query(`select pan.es_outlier_pesaje($1, 2550) as outlier`, [productoId]);
  assert.equal(normal.rows[0].outlier, false, "2.550 g está en línea con la mediana ~2.500");

  const outlier = await db.query(`select pan.es_outlier_pesaje($1, 25000) as outlier`, [productoId]);
  assert.equal(outlier.rows[0].outlier, true, "25.000 g es >3x la mediana ~2.500 — debe marcar outlier");
  await db.close();
});

