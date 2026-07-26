// Acceso a BD. Dos modos, un solo contrato:
//   DB_MODE=pglite    -> desarrollo en una máquina, cero instalación (default local)
//   DB_MODE=postgres  -> Postgres hospedado, el modo real de operación
//
// pglite es un motor EMBEBIDO de un solo proceso: sirve para desarrollar en el Mac,
// pero no puede atender a la tablet del mesón, el teléfono del repartidor y el del
// dueño a la vez. Para operar de verdad —y más si es por datos móviles— hace falta
// Postgres hospedado. El SQL de las migraciones es el mismo; cambia el transporte.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface ClienteDb {
  query: <Fila extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Fila[] }>;
  exec: (sql: string) => Promise<unknown>;
}

// `next dev`/`next start` corren con cwd = apps/kilopan/, pero el server standalone
// (railway.json: "node apps/kilopan/.next/standalone/apps/kilopan/server.js") corre con
// cwd = la raíz del monorepo. Un ../../ fijo desde process.cwd() daba con la carpeta
// correcta en un caso y con basura en el otro — silenciosamente: pglite no tiraba "no
// existe la carpeta", tiraba el genérico "PGlite failed to initialize properly", y
// leerEnvLocal() simplemente no encontraba el .env.local y la app arrancaba en pglite
// por defecto sin decir por qué. Subir buscando una marca real de la raíz (db/migraciones,
// que solo existe ahí) funciona sea cual sea el cwd desde el que se arrancó node.
function hallarRaizRepo(desde: string): string {
  let dir = desde;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "db", "migraciones"))) return dir;
    const arriba = dirname(dir);
    if (arriba === dir) break;
    dir = arriba;
  }
  throw new Error(
    `no se encontró la raíz del monorepo (buscando db/migraciones/) subiendo desde ${desde}`
  );
}

function leerEnvLocal(): Record<string, string> {
  let raiz: string;
  try {
    raiz = hallarRaizRepo(process.cwd());
  } catch {
    return {}; // sin .env.local no es fatal: en producción las variables vienen del entorno real
  }
  const path = join(raiz, ".env.local");
  const env: Record<string, string> = {};
  if (existsSync(path)) {
    for (const cruda of readFileSync(path, "utf8").split("\n")) {
      // Mismo parser que db/migrar.mjs: quita \r (archivo guardado en Windows) y las
      // comillas envolventes (URL copiada con comillas desde el dashboard del proveedor).
      const linea = cruda.replace(/\r$/, "");
      const m = linea.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1] as string] = (m[2] as string).trim().replace(/^(["'])(.*)\1$/, "$2");
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
    //
    // -c timezone=America/Santiago (Tanda 3 de la auditoría): Railway corre Postgres
    // en UTC, y `current_date`/`col::date` dependen de la zona horaria de LA SESIÓN, no
    // del reloj de la máquina. A las 00:00 UTC —20:00 en Chile— "hoy" saltaba de día
    // para toda la app a mitad de la jornada: pedidos armados a las 20:02 desaparecían
    // de la lista, el cierre de caja del atardecer caía en el día siguiente. Fijarlo acá,
    // en el startup packet (igual que `role`), corrige de una vez cada `current_date`/`::date`
    // de golpe —en las queries, en la vista pan.conciliacion_diaria y en los DEFAULT de
    // columna— sin tocarlos uno por uno y sin depender de que nadie se acuerde de usar
    // un helper. Ver docs/OPERACION_5G_Y_POSTGRES.md sobre por qué el startup packet es
    // el único canal confiable con PgBouncer en modo transacción.
    options: "-c role=pan_app -c timezone=America/Santiago",
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

  // Verificación en la primera conexión: que el rol Y la zona horaria efectivos sean
  // los correctos de verdad. Si `options` no llegara a aplicarse (un pooler que lo
  // filtre, por ejemplo), es mejor caerse acá con un mensaje claro que operar como
  // superusuario, o en UTC, todo el día sin que nadie lo note hasta la noche.
  const comprobacion = await pool.query<{ rol: string; tz: string }>(
    "select current_user as rol, current_setting('TimeZone') as tz"
  );
  const rol = comprobacion.rows[0]?.rol;
  const tz = comprobacion.rows[0]?.tz;
  if (rol !== "pan_app") {
    await pool.end();
    throw new Error(
      `La conexión quedó como "${rol}" y no como pan_app: el mínimo privilegio ` +
        "(AC-SEC-08) no está vigente. Revisa que el rol exista y que el pooler no " +
        "filtre los startup parameters."
    );
  }
  if (tz !== "America/Santiago") {
    await pool.end();
    throw new Error(
      `La conexión quedó con TimeZone="${tz}" y no "America/Santiago": current_date y ` +
        "los ::date de toda la app volverían a cortar el día a las 20:00. Revisa que el " +
        "pooler no filtre los startup parameters."
    );
  }
  console.log(`db: Postgres conectado como ${rol}, TimeZone=${tz} — ${tls.razon}`);

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
  const dataDir = join(hallarRaizRepo(process.cwd()), "db", "data", "pglite");
  const db = new PGlite(dataDir, { extensions: { pgcrypto, btree_gist } });
  await db.exec("set role pan_app");
  // Mismo motivo que el `-c timezone=` del pool de Postgres: sin esto, current_date en
  // desarrollo local queda en la zona horaria del sistema (o UTC) y el comportamiento
  // no coincide con producción — el bug de las 20:00 no se hubiera visto en local.
  await db.exec("set timezone = 'America/Santiago'");
  return db as unknown as ClienteDb;
}

export function obtenerDb(): Promise<ClienteDb> {
  const env = entorno();
  const modo = env.DB_MODE || "pglite";

  if (modo === "postgres") {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("DB_MODE=postgres requiere DATABASE_URL");
    // Si `crearPool` rechaza (corte de red, Railway reiniciando), NO cachear ese
    // promise: sin el .catch de acá, el rechazo queda pegado en `poolPromise` para
    // siempre y cada request futuro recibe el mismo error viejo sin volver a intentar
    // conectarse, aunque la red ya se haya recuperado hace rato.
    if (!poolPromise) {
      poolPromise = crearPool(url).catch((err) => {
        poolPromise = null;
        throw err;
      });
    }
    return poolPromise;
  }

  if (modo === "pglite") {
    if (!pglitePromise) {
      pglitePromise = crearPglite().catch((err) => {
        pglitePromise = null;
        throw err;
      });
    }
    return pglitePromise;
  }

  throw new Error(`DB_MODE desconocido: ${modo}`);
}
