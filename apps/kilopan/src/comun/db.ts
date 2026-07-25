// Acceso a BD. Dos modos, un solo contrato:
//   DB_MODE=pglite    -> desarrollo en una máquina, cero instalación (default local)
//   DB_MODE=postgres  -> Postgres hospedado, el modo real de operación
//
// pglite es un motor EMBEBIDO de un solo proceso: sirve para desarrollar en el Mac,
// pero no puede atender a la tablet del mesón, el teléfono del repartidor y el del
// dueño a la vez. Para operar de verdad —y más si es por datos móviles— hace falta
// Postgres hospedado. El SQL de las migraciones es el mismo; cambia el transporte.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ClienteDb {
  query: <Fila extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Fila[] }>;
  exec: (sql: string) => Promise<unknown>;
}

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

function entorno(): Record<string, string> {
  return { ...leerEnvLocal(), ...process.env } as Record<string, string>;
}

// --------------------------------------------------------------------------
// Postgres hospedado: POOL, no un cliente suelto.
//
// Un cliente único por proceso se cae con la primera desconexión y no soporta
// concurrencia. El pool además es obligatorio con proveedores hospedados, que cierran
// conexiones ociosas de forma agresiva.
//
// `set role pan_app` va en el hook `connect` del pool, no en una llamada suelta: si se
// hiciera una sola vez, cualquier conexión nueva del pool entraría como el dueño del
// esquema y AC-SEC-08 (mínimo privilegio) dejaría de valer en silencio — que es
// exactamente la clase de agujero que no se nota hasta que alguien lo explota.
// --------------------------------------------------------------------------
let poolPromise: Promise<ClienteDb> | null = null;

async function crearPool(url: string): Promise<ClienteDb> {
  const { default: pg } = await import("pg");
  const esLocal = /localhost|127\.0\.0\.1/.test(url);

  const pool = new pg.Pool({
    connectionString: url,
    // TLS obligatorio contra cualquier host remoto: la conexión lleva RUTs, PINs
    // hasheados y evidencia de entregas.
    ssl: esLocal ? undefined : { rejectUnauthorized: true },
    max: Number(entorno().DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Con datos móviles una consulta puede quedar colgada: mejor cortarla que dejar
    // al maestro mirando una pantalla congelada.
    statement_timeout: 15_000,
  });

  pool.on("connect", (client) => {
    void client.query("set role pan_app").catch(() => undefined);
  });
  pool.on("error", (err) => {
    console.error("pool de Postgres:", err.message);
  });

  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: (sql) => pool.query(sql),
  };
}

// --------------------------------------------------------------------------
// pglite: solo desarrollo local.
// --------------------------------------------------------------------------
let pglitePromise: Promise<ClienteDb> | null = null;

async function crearPglite(): Promise<ClienteDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const dataDir = join(process.cwd(), "..", "..", "db", "data", "pglite");
  const db = new PGlite(dataDir, { extensions: { pgcrypto, btree_gist } });
  await db.exec("set role pan_app");
  return db as unknown as ClienteDb;
}

export function obtenerDb(): Promise<ClienteDb> {
  const env = entorno();
  const modo = env.DB_MODE || "pglite";

  if (modo === "postgres") {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("DB_MODE=postgres requiere DATABASE_URL");
    if (!poolPromise) poolPromise = crearPool(url);
    return poolPromise;
  }

  if (modo === "pglite") {
    if (!pglitePromise) pglitePromise = crearPglite();
    return pglitePromise;
  }

  throw new Error(`DB_MODE desconocido: ${modo}`);
}
