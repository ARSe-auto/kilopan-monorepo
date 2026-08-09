#!/usr/bin/env node
// Offboarding: entregarle al tenant SU base de datos completa. [AC-FTEN-17]
//
// Es la métrica de plataforma 7 del §2 y la portabilidad de la Ley 21.719: el tenant se puede
// ir con todo lo suyo. Con una base por tenant (§4.1) eso es literalmente `pg_dump` de UNA
// base — no hay que separar nada de nadie, que es el valor que esa decisión compró por
// adelantado.
//
// El volcado sale en SQL PLANO y con `--no-owner --no-privileges` a propósito: lo que se
// entrega tiene que poder restaurarse en cualquier PostgreSQL del mundo, con los roles de
// quien lo reciba, sin nuestro `migrator` ni nuestro `app_t_<slug>`. Un `-Fc` con nuestros
// dueños adentro sería un archivo que solo nosotros podemos abrir, que es lo contrario de
// portabilidad.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CLUSTER_LOCAL, bdDeTenant } from "./conectar.mjs";

/** Los binarios del cluster. Mismo default y misma variable que `db/flota/cluster.sh`. */
export const PGBIN =
  process.env.FLOTA_PG_BIN ?? "/Users/alexismacmini/apps/Postgres.app/Contents/Versions/18/bin";

function binario(nombre) {
  const ruta = join(PGBIN, nombre);
  if (!existsSync(ruta)) {
    throw new Error(
      `no encuentro ${nombre} en ${PGBIN}. Instalá Postgres.app 18 o exportá FLOTA_PG_BIN.`,
    );
  }
  return ruta;
}

/**
 * Vuelca la base de un tenant a un archivo `.sql`. Devuelve `{ bd, archivo, bytes }`.
 *
 * No se le pasa `--data-only` ni `--schema-only`: lo que se entrega es la base ENTERA, con su
 * esquema, sus datos y sus funciones — incluida `tenant_actual()`, que es lo que hace que los
 * CHECK sigan siendo verdad del otro lado.
 */
export function volcarTenant(slug, { destino } = {}) {
  const bd = bdDeTenant(slug);
  const archivo = destino ?? join(process.cwd(), `${bd}.sql`);
  mkdirSync(dirname(archivo), { recursive: true });

  execFileSync(
    binario("pg_dump"),
    [
      "-h", CLUSTER_LOCAL.host,
      "-p", String(CLUSTER_LOCAL.puerto),
      "-U", CLUSTER_LOCAL.superusuario,
      "-d", bd,
      "--format=plain",
      "--no-owner",
      "--no-privileges",
      "--file", archivo,
    ],
    { stdio: "pipe" },
  );
  return { bd, archivo, bytes: statSync(archivo).size };
}

/**
 * Restaura un volcado en una base NUEVA, como lo haría quien lo recibe.
 *
 * `crearBase` está acá y no se reusa el de `provisionar.mjs` a propósito: la restauración NO
 * pasa por la plantilla. Si pasara, el test no probaría que el volcado se basta a sí mismo.
 */
export function restaurarEn(bdDestino, archivo, { dueno } = {}) {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(bdDestino)) {
    throw new Error(`nombre de base no citable: «${bdDestino}»`);
  }
  const psql = binario("psql");
  const base = [
    "-h", CLUSTER_LOCAL.host,
    "-p", String(CLUSTER_LOCAL.puerto),
    "-U", CLUSTER_LOCAL.superusuario,
  ];
  execFileSync(psql, [...base, "-d", "postgres", "-c",
    `drop database if exists ${bdDestino} with (force)`], { stdio: "pipe" });
  execFileSync(psql, [...base, "-d", "postgres", "-c",
    `create database ${bdDestino}${dueno ? ` owner ${dueno}` : ""}`], { stdio: "pipe" });

  // `ON_ERROR_STOP=1` es la diferencia entre «restauró» y «corrió y algunas cosas fallaron»:
  // psql sigue adelante por omisión y termina en 0 con la base a medias.
  const salida = execFileSync(
    psql,
    [...base, "-d", bdDestino, "-v", "ON_ERROR_STOP=1", "-f", archivo],
    { stdio: "pipe", encoding: "utf8" },
  );
  return { bd: bdDestino, salida };
}

/** ¿El volcado se entiende solo? Lo que se le entrega al tenant no puede necesitar contexto. */
export function volcadoIncluye(archivo, patron) {
  return patron.test(readFileSync(archivo, "utf8"));
}

// --- CLI -------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [slug, destino] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!slug) {
    console.error("offboarding.mjs: uso: offboarding.mjs <slug> [archivo.sql]");
    process.exit(2);
  }
  try {
    const r = volcarTenant(slug, { destino });
    console.log(`offboarding: ${r.bd} → ${r.archivo} (${r.bytes} bytes)`);
    process.exit(0);
  } catch (e) {
    console.error(`offboarding: ${e.message}`);
    process.exit(1);
  }
}
