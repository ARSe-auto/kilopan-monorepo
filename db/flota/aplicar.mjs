#!/usr/bin/env node
// Aplica las migraciones de un destino (`control` o `tenant`) a UNA base de datos, llevando
// la cuenta en `schema_migrations`. Es la pieza que el runner ×N repite base por base
// (`db/flota/migrar.mjs`); acá vive la mecánica de UNA sola base, para poder probarla sola.
//
// Cada migración corre dentro de su propia transacción: o entra entera o no entra. Y se
// guarda su sha256, así que editar una migración YA aplicada se detecta en vez de quedar
// como una diferencia invisible entre dos bases que dicen estar a la misma versión.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const DIR_MIGRACIONES = join(RAIZ, "db/migraciones-flota");

/** Las migraciones de un destino, ordenadas por su número. */
export function migracionesDe(destino, dir = DIR_MIGRACIONES) {
  const carpeta = join(dir, destino);
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((archivo) => {
      const sql = readFileSync(join(carpeta, archivo), "utf8");
      return {
        version: archivo.replace(/\.sql$/, ""),
        archivo: join(carpeta, archivo),
        sql,
        sha256: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/** Qué versiones ya están aplicadas en esta base. Vacío si `schema_migrations` no existe. */
export async function aplicadasEn({ sql }) {
  const [{ existe }] = await sql("select to_regclass('schema_migrations') is not null as existe");
  if (!existe) return new Map();
  const filas = await sql("select version, sha256 from schema_migrations");
  return new Map(filas.map((f) => [f.version, f.sha256]));
}

/**
 * Aplica lo pendiente. Devuelve `{ aplicadas, yaEstaban }`.
 *
 * `verificarSha` en falso solo para el caso legítimo de una plantilla recién creada por
 * TEMPLATE, que hereda las filas de `schema_migrations` de su origen.
 */
export async function aplicar(conexion, destino, { dir = DIR_MIGRACIONES } = {}) {
  const { sql } = conexion;
  // La contabilidad del runner la crea el RUNNER, no una migración. Cuando la creaba
  // `tenant/0001`, el destino `control` —que tiene sus propias migraciones y ninguna de
  // ellas— se caía con «relation schema_migrations does not exist» en la primera corrida.
  await sql(`create table if not exists schema_migrations (
    version     text        not null primary key,
    sha256      text        not null,
    aplicada_en timestamptz not null default now()
  )`);
  const pendientes = [];
  const yaEstaban = [];
  const migraciones = migracionesDe(destino, dir);
  const aplicadas = await aplicadasEn(conexion);

  for (const m of migraciones) {
    const sha = aplicadas.get(m.version);
    if (sha === undefined) {
      pendientes.push(m);
    } else if (sha !== m.sha256) {
      throw new Error(
        `la migración ${destino}/${m.version} cambió DESPUÉS de aplicarse ` +
          `(sha en la base ${sha.slice(0, 12)}…, en disco ${m.sha256.slice(0, 12)}…). ` +
          "Una migración aplicada no se edita: se escribe una nueva.",
      );
    } else {
      yaEstaban.push(m.version);
    }
  }

  for (const m of pendientes) {
    await sql("begin");
    try {
      await sql(m.sql);
      await sql("insert into schema_migrations (version, sha256) values ($1, $2)", [
        m.version,
        m.sha256,
      ]);
      await sql("commit");
    } catch (e) {
      await sql("rollback");
      throw new Error(`${destino}/${m.version} falló y se revirtió entera: ${e.message}`);
    }
  }

  return { aplicadas: pendientes.map((m) => m.version), yaEstaban };
}

/** La última versión que un destino debería tener aplicada. */
export function versionEsperada(destino, dir = DIR_MIGRACIONES) {
  const ms = migracionesDe(destino, dir);
  return ms.length ? ms[ms.length - 1].version : null;
}
