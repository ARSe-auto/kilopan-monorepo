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
// Dos decisiones acá NO son de estilo; se corrigieron tras investigar cómo funciona
// Railway de verdad, y cada una tapaba un agujero real:
//
// 1. EL ROL VA EN EL HANDSHAKE, no en una query posterior.
//    La versión anterior hacía `client.query("set role pan_app").catch(() => undefined)`
//    en el hook `connect`. Dos fallas: (a) el `.catch` silencioso entregaba al pool una
//    conexión que NO era pan_app, y en Railway el usuario de DATABASE_URL es el rol
//    bootstrap de initdb —SUPERUSUARIO real, sin la contención de RDS o Supabase—, o
//    sea que el mínimo privilegio de AC-SEC-08 se evaporaba en silencio; (b) un SET
//    ROLE de sesión no sobrevive a PgBouncer en modo transacción, que Railway ofrece
//    como un simple toggle de UI que reapunta DATABASE_URL sin avisarle al código.
//    `options: "-c role=pan_app"` viaja en el startup packet: se aplica al autenticar,
//    y si el rol no existe la conexión FALLA en vez de degradarse a superusuario.
//    Falla cerrado, que es lo que corresponde cuando lo que está en juego es el
//    privilegio.
//
// 2. TLS SEGÚN LA RED, no una regla ciega.
//    Railway genera un certificado AUTOFIRMADO dentro del contenedor, con CN=localhost
//    y sin el hostname del proxy en el SAN. Verificación estricta contra el proxy
//    público es IMPOSIBLE por construcción, no por configuración: no existe CA que
//    descargar y el nombre nunca va a coincidir. Ver docs/OPERACION_5G_Y_POSTGRES.md.
// --------------------------------------------------------------------------
let poolPromise: Promise<ClienteDb> | null = null;

/** Decide la política TLS a partir de la URL, y explica por qué. */
export function politicaTls(url: string, env: Record<string, string>) {
  if (/localhost|127\.0\.0\.1/.test(url)) {
    return { ssl: undefined, razon: "host local: TLS no aplica" };
  }
  // Red privada de Railway: el transporte ya va cifrado con Wireguard entre servicios,
  // y negociar TLS ahí solo traería el mismo certificado roto. Es el camino recomendado
  // para producción.
  if (/\.railway\.internal/.test(url)) {
    return { ssl: false as const, razon: "red privada de Railway (cifrada con Wireguard)" };
  }
  // Cualquier otro host remoto: cifrar siempre. La pregunta es si además se verifica.
  if (env.KILOPAN_TLS_SIN_VERIFICAR === "1") {
    return {
      ssl: { rejectUnauthorized: false },
      razon: "TLS cifrado SIN verificar el certificado (aceptado explícitamente)",
    };
  }
  return { ssl: { rejectUnauthorized: true }, razon: "TLS con verificación estricta" };
}

async function crearPool(url: string): Promise<ClienteDb> {
  const { default: pg } = await import("pg");
  const env = entorno();

  if (/[?&]sslmode=/.test(url)) {
    // node-postgres NO usa la semántica de libpq: trata `require` y `verify-ca` como
    // alias de `verify-full`, y —peor— si la URL trae sslmode, descarta en silencio el
    // objeto `ssl` de acá abajo. Mezclar los dos canales deja la política TLS en un
    // estado que nadie escribió a propósito.
    throw new Error(
      "DATABASE_URL no debe llevar ?sslmode=: en node-postgres pisa la configuración TLS " +
        "del código. Quítalo de la URL y usa KILOPAN_TLS_SIN_VERIFICAR=1 si el proveedor " +
        "usa certificado autofirmado (ver docs/OPERACION_5G_Y_POSTGRES.md)."
    );
  }

  const tls = politicaTls(url, env);

  const pool = new pg.Pool({
    connectionString: url,
    ssl: tls.ssl,
    // AC-SEC-08 en el handshake: si pan_app no existe o no se puede asumir, la
    // conexión no se establece. Nunca se degrada a superusuario en silencio.
    options: "-c role=pan_app",
    max: Number(env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Con datos móviles una consulta puede quedar colgada: mejor cortarla que dejar
    // al maestro mirando una pantalla congelada.
    statement_timeout: 15_000,
  });

  pool.on("error", (err) => {
    console.error("pool de Postgres:", err.message);
  });

  // Verificación en la primera conexión: que el rol efectivo sea pan_app de verdad.
  // Si `options` no llegara a aplicarse (un pooler que lo filtre, por ejemplo), es
  // mejor caerse acá con un mensaje claro que operar como superusuario todo el día.
  const comprobacion = await pool.query<{ rol: string }>("select current_user as rol");
  const rol = comprobacion.rows[0]?.rol;
  if (rol !== "pan_app") {
    await pool.end();
    throw new Error(
      `La conexión quedó como "${rol}" y no como pan_app: el mínimo privilegio ` +
        "(AC-SEC-08) no está vigente. Revisa que el rol exista y que el pooler no " +
        "filtre los startup parameters."
    );
  }
  console.log(`db: Postgres conectado como ${rol} — ${tls.razon}`);

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
