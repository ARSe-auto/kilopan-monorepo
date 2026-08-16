#!/usr/bin/env node
// Conexión al cluster de FLOTA. Un solo lugar decide a qué servidor se habla y con qué rol,
// para que ningún script invente su propia cadena (§7.1: `DATABASE_URL` solo localhost).
//
// Precedencia: `FLOTA_DATABASE_URL` del entorno → `DATABASE_URL` de `apps/flota/.env.local`
// → el cluster local de desarrollo (docs/CONTRATO_PUERTOS.md). El último existe para que el
// gate corra en una máquina recién clonada sin pedirle nada a nadie.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ENV_FILE = join(RAIZ, "apps/flota/.env.local");

/** Cluster local de FLOTA. El 54331 es suyo; el 54329 es de eauto y no se toca. */
export const CLUSTER_LOCAL = {
  host: "127.0.0.1",
  puerto: 54331,
  superusuario: "flota_admin",
};

export const BD_CONTROL = "control";
export const BD_PLANTILLA = "tenant_template";
/** Tenant sintético al que el runner migra PRIMERO (§4.1, centinela 13). */
export const TENANT_CANARIO = "canary";

/**
 * Rol que corre las migraciones y DUEÑO de las bases (§4.1: «rol `migrator` separado; la app
 * no tiene ownership»). Separarlo del rol de app no es higiene: es lo que hace que un bug en
 * el producto no pueda cambiar el esquema, y que un superusuario no ande suelto en el deploy.
 */
export const ROL_MIGRADOR = "migrator";

/** `t_<slug>`: el único lugar donde se arma el nombre de la BD de un tenant (§0). */
export function bdDeTenant(slug) {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(slug)) {
    throw new Error(
      `slug inválido: «${slug}». Va al nombre de una base de datos y de un rol, así que es ` +
        "minúsculas, dígitos y guion bajo, empezando por letra.",
    );
  }
  return `t_${slug}`;
}

/** `app_t_<slug>`: rol de aplicación del tenant (§4.1). */
export function rolDeTenant(slug) {
  return `app_${bdDeTenant(slug)}`;
}

/** El camino de vuelta: `t_<slug>` → `<slug>`. `null` si el nombre no es de un tenant. */
export function slugDeBd(bd) {
  const slug = /^t_(.+)$/.exec(bd)?.[1];
  if (!slug) return null;
  try {
    return bdDeTenant(slug) === bd ? slug : null;
  } catch {
    return null;
  }
}

function baseDelEntorno() {
  if (process.env.FLOTA_DATABASE_URL) return process.env.FLOTA_DATABASE_URL;
  if (existsSync(ENV_FILE)) {
    const url = readFileSync(ENV_FILE, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("DATABASE_URL="))
      .pop()
      ?.slice("DATABASE_URL=".length)
      .trim();
    if (url) return url;
  }
  return `postgres://${CLUSTER_LOCAL.superusuario}@${CLUSTER_LOCAL.host}:${CLUSTER_LOCAL.puerto}/postgres`;
}

/**
 * Host, puerto y usuario EFECTIVOS del cluster: los de `FLOTA_DATABASE_URL` si está definida, y
 * si no los del cluster local.
 *
 * Existe porque `pg_dump` y `psql` reciben el destino por BANDERAS y no por cadena de conexión:
 * quien las arma leyendo `CLUSTER_LOCAL` a mano queda clavado al 54331 aunque el entorno diga
 * otra cosa. Con dos motores —cada uno con su cluster— eso significaba que el segundo volcaba y
 * restauraba en las bases del PRIMERO sin que nada lo delatara (12-ago-2026: la suite de
 * tenancy del worktree 2 falló con «t_gate_offb does not exist» contra el 54331).
 */
export function destinoDelCluster() {
  const u = new URL(baseDelEntorno());
  return {
    host: u.hostname || CLUSTER_LOCAL.host,
    puerto: u.port || String(CLUSTER_LOCAL.puerto),
    usuario: decodeURIComponent(u.username) || CLUSTER_LOCAL.superusuario,
  };
}

/** Cadena de conexión a una base concreta del cluster, con el rol que se pida. */
export function urlDe(bd, { usuario, clave } = {}) {
  const base = new URL(baseDelEntorno());
  base.pathname = `/${bd}`;
  if (usuario) base.username = usuario;
  if (clave !== undefined) base.password = clave;
  return base.toString();
}

/**
 * Abre una conexión y devuelve `{ sql, cliente, cerrar }`.
 *
 * `sql(texto, params)` devuelve las filas ya desenvueltas: el 95% de las consultas de estos
 * scripts solo quieren las filas, y escribir `.rows` en cada llamada invita a olvidarlo.
 */
export async function conectar(bd = "postgres", opciones = {}) {
  const cliente = new pg.Client({ connectionString: urlDe(bd, opciones) });
  await cliente.connect();
  // Todo corre en horario de Chile: una fecha de servicio calculada en UTC parte el día a
  // las 20:00 y manda encargos al día siguiente (lección pagada en KiloPan).
  await cliente.query("set time zone 'America/Santiago'");
  return {
    cliente,
    sql: async (texto, params = []) => (await cliente.query(texto, params)).rows,
    cerrar: () => cliente.end(),
  };
}

/** Corre `fn` con una conexión y la cierra pase lo que pase. */
export async function con(bd, fn, opciones = {}) {
  const conexion = await conectar(bd, opciones);
  try {
    return await fn(conexion);
  } finally {
    await conexion.cerrar();
  }
}
