import { Pool } from "pg";

// Conexiones del servidor de FLOTA [AC-FTEN-05]. UN pool POR BASE, jamás uno compartido:
// el §4.1 pone a cada tenant en su propia base con su propio rol, y un pool compartido
// sería la puerta trasera que anula todo eso — la conexión de A quedaría disponible para
// servir un request de B.
//
// PgBouncer entra sin cambiar una línea de acá: es multi-database, así que el destino se
// elige por NOMBRE DE BASE igual que contra Postgres directo. Lo único que cambia entre
// desarrollo y producción es a qué host/puerto apunta la cadena. El límite de pool POR
// tenant se declara en la config que genera `db/flota/pgbouncer.mjs`, no en este archivo:
// un límite escrito acá viviría en el proceso de la app y no protegería al servidor.
//
// ALCANCE DECLARADO: en CI no corre un proceso PgBouncer (no está instalado en la máquina
// del gate). Lo que el gate verifica es lo verificable sin él y es lo que de verdad puede
// romperse en el código: que cada tenant use el pool de SU base, que un tenant no activo no
// abra NINGUNA conexión, y que la config generada declare un límite por cada tenant
// registrado. Levantar un PgBouncer real en CI es infraestructura del despliegue, no de
// este AC, y decirlo es preferible a un verde que insinúe que se probó.

/** Cluster local de FLOTA. El 54331 es suyo; el 54329 es de eauto y no se toca. */
const CLUSTER_LOCAL = "postgres://flota_admin@127.0.0.1:54331";

/**
 * Precedencia idéntica a la de `db/flota/conectar.mjs`, que es la fuente del naming y de la
 * cadena para los scripts de operación: `FLOTA_DATABASE_URL` → `DATABASE_URL` → cluster
 * local. El último existe para que el gate corra en una máquina recién clonada sin pedirle
 * nada a nadie; en producción la cadena apunta a PgBouncer.
 */
function baseUrl(): string {
  return process.env.FLOTA_DATABASE_URL || process.env.DATABASE_URL || CLUSTER_LOCAL;
}

/** `postgres://…/<bd>`: el destino se elige por nombre de base, que es como rutea PgBouncer. */
export function urlDeBase(bd: string): string {
  const url = new URL(baseUrl());
  url.pathname = `/${bd}`;
  return url.toString();
}

// Un pool por base, memorizado por nombre. Se guarda en `globalThis` y no en un módulo
// suelto porque en desarrollo Next recarga los módulos en caliente: sin esto, cada edición
// dejaría atrás un pool con sus conexiones abiertas y el cluster se quedaría sin cupo a la
// media hora de trabajo.
const registro: Map<string, Pool> =
  (globalThis as { __flotaPools?: Map<string, Pool> }).__flotaPools ??
  ((globalThis as { __flotaPools?: Map<string, Pool> }).__flotaPools = new Map());

/**
 * El pool de UNA base. Crear un pool NO abre conexiones —`pg` las abre en el primer
 * `query()`—, así que la garantía de «cero acceso a la base de un tenant suspendido» la da
 * quien llama, no este módulo: el ruteo simplemente nunca llega hasta acá para un tenant que
 * no está activo. El test lo verifica contando conexiones en `pg_stat_activity`, que es lo
 * único que no se puede fingir.
 */
export function poolDe(bd: string): Pool {
  const existente = registro.get(bd);
  if (existente) return existente;
  const pool = new Pool({
    connectionString: urlDeBase(bd),
    // Cota del lado del cliente. La cota que de verdad protege al servidor es la de
    // PgBouncer, por tenant, en la config generada: esta solo evita que un pico en UN
    // proceso de la app se lleve puesto el cupo de todos.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  registro.set(bd, pool);
  return pool;
}

/** Bases con pool VIVO en este proceso. Existe para que el test pueda asertar ausencia. */
export function basesConPool(): string[] {
  return [...registro.keys()];
}
