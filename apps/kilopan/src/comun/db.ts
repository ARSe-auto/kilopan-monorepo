// Acceso a BD en runtime (rutas API). Duplicado deliberado, mínimo, de la lógica de
// conexión de db/migrar.mjs — ese script vive fuera de apps/kilopan y encadenar el
// bundling de Next.js a través del borde del monorepo no vale la complejidad para dos
// funciones. Si diverge, es una señal de que ya es hora del hito de extracción a
// packages/nucleo-comun.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Server-only: nunca importar este archivo desde un componente cliente.
export interface ClienteDb {
  query: <Fila extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Fila[] }>;
  exec: (sql: string) => Promise<unknown>;
}

let clientePromise: Promise<ClienteDb> | null = null;

function leerEnvLocal(): Record<string, string> {
  const path = join(process.cwd(), ".env.local");
  const env: Record<string, string> = {};
  if (existsSync(path)) {
    for (const linea of readFileSync(path, "utf8").split("\n")) {
      const m = linea.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1] as string] = m[2] as string;
    }
  }
  return env;
}

async function crearCliente(): Promise<ClienteDb> {
  const env = { ...leerEnvLocal(), ...process.env } as Record<string, string>;
  const modo = env.DB_MODE || "pglite";

  if (modo === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
    const dataDir = join(process.cwd(), "..", "..", "db", "data", "pglite");
    const db = new PGlite(dataDir, { extensions: { pgcrypto, btree_gist } });
    await db.exec("set role pan_app"); // AC-SEC-08: la app nunca corre como dueño del esquema
    return db as unknown as ClienteDb;
  }

  if (modo === "postgres") {
    if (!env.DATABASE_URL || !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
      throw new Error("guardrail: DATABASE_URL debe apuntar a localhost en modo postgres");
    }
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    await client.query("set role pan_app");
    return client as unknown as ClienteDb;
  }

  throw new Error(`DB_MODE desconocido: ${modo}`);
}

/** Conexión única por proceso (evita abrir un pglite nuevo en cada hot-reload de dev). */
export function obtenerDb(): Promise<ClienteDb> {
  if (!clientePromise) {
    clientePromise = crearCliente();
  }
  return clientePromise;
}
