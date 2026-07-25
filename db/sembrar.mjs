#!/usr/bin/env node
// Seed de desarrollo — PROMPT_MAESTRO.md §10 (1 panadería, 4 usuarios, catálogo real).
// Crece con cada hito. Idempotente: se puede correr varias veces (usa ON CONFLICT
// donde hay una clave natural, o limpia antes si no la hay).
import { conectar } from "./migrar.mjs";

// PIN de todos los usuarios semilla: 1234 (hash real via scrypt, no en texto plano).
async function hashearPin(pin) {
  const { scrypt, randomBytes } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const scryptAsync = promisify(scrypt);
  const sal = randomBytes(16);
  const derivada = await scryptAsync(pin, sal, 64);
  return `${sal.toString("hex")}:${derivada.toString("hex")}`;
}

async function main() {
  const { db, modo, cerrar } = await conectar();
  console.log(`sembrar: modo=${modo}`);
  await db.exec("set role pan_app");

  const pinHash = await hashearPin("1234");

  const usuariosSemilla = [
    { nombre: "Ana Dueña", rut: "76.192.083-9", rol: "admin" },
    { nombre: "Pedro Maestro", rut: "12.345.678-5", rol: "maestro" },
    { nombre: "Sofía Vendedora", rut: "10.000.013-K", rol: "vendedor" },
    { nombre: "Luis Repartidor", rut: "5.000.006-0", rol: "repartidor" },
  ];

  console.log("sembrar: usuarios...");
  const usuarioIds = {};
  for (const u of usuariosSemilla) {
    const existente = await db.query(`select id from pan.usuarios where rut = $1`, [u.rut]);
    if (existente.rows.length > 0) {
      usuarioIds[u.rol] = existente.rows[0].id;
      continue;
    }
    const r = await db.query(
      `insert into pan.usuarios (nombre, rut, rol, pin_hash) values ($1,$2,$3,$4) returning id`,
      [u.nombre, u.rut, u.rol, pinHash]
    );
    usuarioIds[u.rol] = r.rows[0].id;
  }

  console.log("sembrar: dispositivo de prueba (secreto: 'demo')...");
  const secretoHash = await hashearPin("demo");
  let dispositivoId;
  const dispExistente = await db.query(`select id from pan.dispositivos where nombre = $1`, ["Tablet mesón (seed)"]);
  if (dispExistente.rows.length > 0) {
    dispositivoId = dispExistente.rows[0].id;
  } else {
    const d = await db.query(
      `insert into pan.dispositivos (nombre, secreto_hash, enrolado_por) values ($1,$2,$3) returning id`,
      ["Tablet mesón (seed)", secretoHash, usuarioIds.admin]
    );
    dispositivoId = d.rows[0].id;
  }

  console.log("sembrar: catálogo (marraqueta, hallulla, frica, dobladitas, integral)...");
  const productos = [
    { nombre: "Marraqueta", mostrador: 2190, mayorista: 1650 },
    { nombre: "Hallulla", mostrador: 2090, mayorista: 1590 },
    { nombre: "Frica", mostrador: 2490, mayorista: 1890 },
    { nombre: "Dobladitas", mostrador: 2890, mayorista: 2190 },
    { nombre: "Integral", mostrador: 2990, mayorista: 2390 },
  ];
  for (const p of productos) {
    let productoId;
    const existente = await db.query(`select id from pan.productos where nombre = $1`, [p.nombre]);
    if (existente.rows.length > 0) {
      productoId = existente.rows[0].id;
    } else {
      const r = await db.query(`insert into pan.productos (nombre, tipo_venta) values ($1,'kilo') returning id`, [
        p.nombre,
      ]);
      productoId = r.rows[0].id;
    }
    for (const [lista, precio] of [
      ["mostrador", p.mostrador],
      ["mayorista", p.mayorista],
    ]) {
      const precioExistente = await db.query(
        `select 1 from pan.precios where producto_id = $1 and lista = $2 and vigente_desde = current_date`,
        [productoId, lista]
      );
      if (precioExistente.rows.length === 0) {
        await db.query(`insert into pan.precios (producto_id, lista, precio_clp) values ($1,$2,$3)`, [
          productoId,
          lista,
          precio,
        ]);
      }
    }
  }

  console.log("sembrar: OK");
  console.log(`  admin:       RUT 76.192.083-9 · PIN 1234`);
  console.log(`  maestro:     RUT 12.345.678-5 · PIN 1234`);
  console.log(`  vendedor:    RUT 10.000.013-K · PIN 1234`);
  console.log(`  repartidor:  RUT 5.000.006-0  · PIN 1234`);
  console.log(`  dispositivo: ${dispositivoId} · secreto "demo"`);
  await cerrar();
}

main().catch((err) => {
  console.error("sembrar: FALLÓ:", err.message);
  process.exit(1);
});
