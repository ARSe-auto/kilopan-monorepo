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
    if (!env.DATABASE_URL || !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
      throw new Error("guardrail: DATABASE_URL debe apuntar a localhost en modo postgres");
    }
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    return { db: client, modo, cerrar: () => client.end() };
  }
  throw new Error(`DB_MODE desconocido: ${modo}`);
}

export async function migrar(db) {
  const archivos = readdirSync(MIGRACIONES_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const archivo of archivos) {
    const sql = readFileSync(join(MIGRACIONES_DIR, archivo), "utf8");
    console.log(`migrando: ${archivo}`);
    await db.exec(sql);
  }
  console.log(`migrar: OK (${archivos.length} archivo(s))`);
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
