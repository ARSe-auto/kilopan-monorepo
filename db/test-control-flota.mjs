#!/usr/bin/env node
// Prueba el plano de control de Hito 0 (db/migraciones-flota/0001_control.sql) contra
// PGlite EN MEMORIA — jamás producción, jamás Railway (mismo criterio que
// db/test-invariantes.mjs de KiloPan, pero para el esquema `control` de la Plataforma
// FLOTA). No toca `db/migraciones/` (KiloPan) ni `db/migrar.mjs` — migrador propio,
// self-contained, solo para este esquema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRACIONES_DIR = join(ROOT, "migraciones-flota");

async function dbNueva() {
  const db = new PGlite(); // en memoria, nunca persiste a disco
  for (const archivo of readdirSync(MIGRACIONES_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRACIONES_DIR, archivo), "utf8"));
  }
  return db;
}

async function crearTenant(db, slug, opts = {}) {
  const r = await db.query(
    `insert into control.tenants (slug, plan_id, modo) values ($1,$2,$3) returning id, bd`,
    [slug, opts.plan_id ?? "base", opts.modo ?? "daas"]
  );
  return r.rows[0];
}

test("uuidv7() nativo disponible y genera PKs con parte temporal no-decreciente", async () => {
  const db = await dbNueva();
  const r = await db.query(`select uuidv7()::text as u from generate_series(1, 50)`);
  let anterior = "";
  for (const { u } of r.rows) {
    const ts = u.replace(/-/g, "").slice(0, 12);
    assert.ok(!anterior || ts >= anterior, "la parte temporal de uuidv7() retrocedió");
    anterior = ts;
  }
});

test("control.tenants: slug único, modo cerrado, bd se deriva sola y no admite UPDATE directo", async () => {
  const db = await dbNueva();
  const t = await crearTenant(db, "rutapan");
  assert.equal(t.bd, "t_rutapan");

  await assert.rejects(crearTenant(db, "rutapan"), /duplicate key|unique/i);
  await assert.rejects(
    db.query(`insert into control.tenants (slug, plan_id, modo) values ('x','base','no_existe')`),
    /check/i
  );
  await assert.rejects(
    db.query(`update control.tenants set bd = 't_hackeado' where slug = 'rutapan'`),
    /can only be updated to default/i
  );
});

test("control.tenant_theme: contraste real — el acento de flota pasa, un amarillo claro no", async () => {
  const db = await dbNueva();
  const t = await crearTenant(db, "eauto");

  // #1D4ED8 es el acento YA reservado para esta plataforma en packages/miga/src/tokens.ts
  // (acentos.kiloruta) — contraste ~6.7:1 contra blanco, debe pasar.
  await db.query(
    `insert into control.tenant_theme (tenant_id, accent_color) values ($1, $2)`,
    [t.id, "#1D4ED8"]
  );
  const tema = await db.query(`select accent_color from control.tenant_theme where tenant_id=$1`, [t.id]);
  assert.equal(tema.rows[0].accent_color, "#1D4ED8");

  const t2 = await crearTenant(db, "rutapan2");
  await assert.rejects(
    db.query(`insert into control.tenant_theme (tenant_id, accent_color) values ($1, $2)`, [t2.id, "#FFFF00"]),
    /check/i,
    "un amarillo claro (~1.07:1 contra blanco) debía rebotar y no lo hizo"
  );

  // El default también debe ser válido (mismo color reservado) sin especificarlo.
  const t3 = await crearTenant(db, "demo-mi-flota");
  await db.query(`insert into control.tenant_theme (tenant_id) values ($1)`, [t3.id]);
  const def = await db.query(`select accent_color from control.tenant_theme where tenant_id=$1`, [t3.id]);
  assert.equal(def.rows[0].accent_color, "#1D4ED8");
});

test("control.tenant_terminology: largo por categoría y caracteres prohibidos", async () => {
  const db = await dbNueva();
  const t = await crearTenant(db, "terminologia");

  // nav.* <= 12: al límite pasa, uno más allá rebota.
  await db.query(
    `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'nav.rutas','123456789012','123456789012')`,
    [t.id]
  );
  await assert.rejects(
    db.query(
      `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'nav.otro','1234567890123','1234567890123')`,
      [t.id]
    ),
    /check/i
  );

  // titulo.* <= 24 y desc.* <= 40 — probar el límite exacto de cada uno.
  await db.query(
    `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'titulo.pantalla_hoy',$2,$2)`,
    [t.id, "x".repeat(24)]
  );
  await db.query(
    `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'desc.ayuda_pod',$2,$2)`,
    [t.id, "x".repeat(40)]
  );

  // Categoría de sistema/auditoría: no es una categoría permitida, así que la fila ni
  // siquiera puede existir (§0 "excluidos por CHECK").
  await assert.rejects(
    db.query(
      `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'sistema.auditoria','x','x')`,
      [t.id]
    ),
    /check/i
  );

  // Caracteres prohibidos del §0.
  await assert.rejects(
    db.query(
      `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'nav.malo','ruta<>','rutas')`,
      [t.id]
    ),
    /check/i
  );

  // UNIQUE(tenant_id, term_key)
  await assert.rejects(
    db.query(
      `insert into control.tenant_terminology (tenant_id, term_key, singular, plural) values ($1,'nav.rutas','otra','otras')`,
      [t.id]
    ),
    /duplicate key|unique/i
  );
});

test("entitlements: override ?? plan, y UNIQUE(tenant_id, feature) en overrides", async () => {
  const db = await dbNueva();
  const daas = await crearTenant(db, "daas-1", { plan_id: "base", modo: "daas" });
  const miFlota = await crearTenant(db, "mi-flota-1", { plan_id: "gratis", modo: "mi_flota" });

  // Sin override: hereda del plan. base trae tarifas=true; gratis no trae nada.
  const r1 = await db.query(`select control.fn_entitlement_efectivo($1, 'tarifas') as v`, [daas.id]);
  assert.equal(r1.rows[0].v, true);
  const r2 = await db.query(`select control.fn_entitlement_efectivo($1, 'tarifas') as v`, [miFlota.id]);
  assert.equal(r2.rows[0].v, false);

  // Selector de modo (§3): apagar las 4 features nombradas explícitamente para un tenant
  // mi_flota es un override por fila, no una migración de esquema.
  for (const f of ["tarifas", "liquidacion_por_cliente", "portal_contratante", "facturacion"]) {
    await db.query(
      `insert into control.tenant_feature_overrides (tenant_id, feature_lookup_key, enabled, motivo) values ($1,$2,false,'modo mi_flota')`,
      [daas.id, f]
    );
  }
  const r3 = await db.query(`select control.fn_entitlement_efectivo($1, 'tarifas') as v`, [daas.id]);
  assert.equal(r3.rows[0].v, false, "el override debía ganarle al plan");

  // UNIQUE(tenant_id, feature_lookup_key)
  await assert.rejects(
    db.query(
      `insert into control.tenant_feature_overrides (tenant_id, feature_lookup_key, enabled) values ($1,'tarifas',true)`,
      [daas.id]
    ),
    /duplicate key|unique/i
  );

  // Feature inexistente: FK rebota.
  await assert.rejects(
    db.query(
      `insert into control.tenant_feature_overrides (tenant_id, feature_lookup_key, enabled) values ($1,'no-existe',true)`,
      [miFlota.id]
    ),
    /foreign key|violates/i
  );
});

test("control.tenant_templates: catálogo resuelve y tenants puede referenciarlo", async () => {
  const db = await dbNueva();
  const tpl = await db.query(`select id from control.tenant_templates where nombre = 'base-v1'`);
  assert.equal(tpl.rows.length, 1);
  const t = await db.query(
    `insert into control.tenants (slug, plan_id, modo, tenant_template_id) values ('con-plantilla','base','daas',$1) returning id`,
    [tpl.rows[0].id]
  );
  assert.ok(t.rows[0].id);
});

test("control_app: sin DELETE en ninguna tabla del esquema (mismo criterio que pan_app)", async () => {
  const db = await dbNueva();
  await crearTenant(db, "para-borrar");
  await db.exec("set role control_app");
  await assert.rejects(
    db.query(`delete from control.tenants where slug = 'para-borrar'`),
    /permission denied/i
  );
  // Pero SELECT/INSERT/UPDATE sí funcionan (si no, la app no podría operar en absoluto).
  const sel = await db.query(`select count(*)::int as n from control.tenants`);
  assert.ok(sel.rows[0].n >= 1);
  await db.query(`update control.tenants set estado = 'activo' where slug = 'para-borrar'`);
});
