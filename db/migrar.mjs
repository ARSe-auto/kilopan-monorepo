#!/usr/bin/env node
// Aplica db/migraciones/*.sql en orden. DB_MODE=pglite (default, cero instalación) o
// postgres (real, DATABASE_URL) — ver .env.local.example y docs/BASE_DE_DATOS.md.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRACIONES_DIR = join(ROOT, "migraciones");

function leerEnvLocal() {
  const path = join(ROOT, "..", ".env.local");
  const env = {};
  if (existsSync(path)) {
    for (const linea of readFileSync(path, "utf8").split("\n")) {
      const m = linea.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

export async function conectar() {
  const env = { ...leerEnvLocal(), ...process.env };
  const modo = env.DB_MODE || "pglite";
  if (modo === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
    const dataDir = join(ROOT, "data", "pglite");
    const db = new PGlite(dataDir, { extensions: { pgcrypto, btree_gist } });
    return { db, modo, cerrar: () => db.close() };
  }
  if (modo === "postgres") {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("DB_MODE=postgres requiere DATABASE_URL");
    const esLocal = /localhost|127\.0\.0\.1/.test(url);
    if (!esLocal && env.KILOPAN_DB_REMOTA_INTENCIONAL !== "1") {
      throw new Error(
        "guardrail: migrar contra una BD remota exige KILOPAN_DB_REMOTA_INTENCIONAL=1 " +
          "— aplicar migraciones sobre la panadería equivocada no tiene deshacer"
      );
    }
    const { default: pg } = await import("pg");
    // Las migraciones corren como DUEÑO del esquema, no como pan_app: crean tablas,
    // triggers y grants. Es el único lugar del sistema donde eso es correcto.
    const client = new pg.Client({
      connectionString: url,
      ssl: esLocal ? undefined : { rejectUnauthorized: true },
    });
    await client.connect();
    return {
      db: { exec: (sql) => client.query(sql), query: (sql, p) => client.query(sql, p) },
      modo,
      cerrar: () => client.end(),
    };
  }
  throw new Error(`DB_MODE desconocido: ${modo}`);
}

export async function migrar(db) {
  // Registro de lo ya aplicado: sin esto, `migrar` solo funciona sobre una BD vacía —
  // que es exactamente lo que el guardrail «jamás migración destructiva» prohíbe hacer
  // en un entorno con evidencia (fotos de POD). Encontrado al aplicar la 6ª migración
  // sobre datos existentes.
  await db.exec(`
    create schema if not exists pan;
    create table if not exists pan.migraciones_aplicadas (
      archivo text primary key,
      aplicada_at timestamptz not null default now()
    );
  `);

  const yaAplicadas = new Set(
    (await db.query(`select archivo from pan.migraciones_aplicadas`)).rows.map((r) => r.archivo)
  );

  const archivos = readdirSync(MIGRACIONES_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let nuevas = 0;
  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) {
      console.log(`ya aplicada: ${archivo}`);
      continue;
    }
    const sql = readFileSync(join(MIGRACIONES_DIR, archivo), "utf8");
    console.log(`migrando: ${archivo}`);
    await db.exec(sql);
    await db.query(`insert into pan.migraciones_aplicadas (archivo) values ($1)`, [archivo]);
    nuevas++;
  }
  console.log(`migrar: OK (${nuevas} nueva(s) de ${archivos.length})`);
}

async function main() {
  const { db, modo, cerrar } = await conectar();
  console.log(`db: modo=${modo}`);
  await migrar(db);
  await cerrar();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("migrar: FALLÓ:", err.message);
    process.exit(1);
  });
}
