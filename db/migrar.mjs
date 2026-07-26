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
    for (const cruda of readFileSync(path, "utf8").split("\n")) {
      // El \r se quita de la LÍNEA antes de matchear (un archivo guardado en Windows
      // dejaba el retorno de carro dentro del valor), y las comillas envolventes
      // también: el flujo real es copiar la URL del dashboard del proveedor y pegarla,
      // a veces entrecomillada. Sin esto, el error que sale es un ENOTFOUND sobre un
      // host que empieza con comilla — que no apunta para nada al problema real.
      const linea = cruda.replace(/\r$/, "");
      const m = linea.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
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
    // Ver el mismo override en apps/kilopan/src/comun/db.ts: el e2e migra y siembra su
    // propia base para no pisar la de desarrollo ni pelearse el lock del proceso.
    const dataDir = env.KILOPAN_PGLITE_DIR || join(ROOT, "data", "pglite");
    const db = new PGlite(dataDir, { extensions: { pgcrypto, btree_gist } });
    return { db, modo, cerrar: () => db.close() };
  }
  if (modo === "postgres") {
    // Override explícito para migraciones. Existe porque los proveedores que ofrecen
    // un pooler (PgBouncer en modo transacción) reapuntan DATABASE_URL al pooler sin
    // avisar, y ahí las migraciones fallan: DDL, funciones y `set` de sesión no
    // sobreviven al modo transacción. UNA sola variable y falla fuerte — nada de
    // elegir sola entre cuatro cadenas en silencio.
    const url = env.KILOPAN_MIGRACIONES_URL || env.DATABASE_URL;
    if (!url) throw new Error("DB_MODE=postgres requiere DATABASE_URL");

    if (/[?&]sslmode=/.test(url)) {
      throw new Error(
        "La URL no debe llevar ?sslmode=: en node-postgres pisa la configuración TLS " +
          "del código (trata 'require' como 'verify-full'). Ver docs/OPERACION_5G_Y_POSTGRES.md"
      );
    }

    const esLocal = /localhost|127\.0\.0\.1/.test(url);
    if (!esLocal && env.KILOPAN_DB_REMOTA_INTENCIONAL !== "1") {
      throw new Error(
        "guardrail: migrar contra una BD remota exige KILOPAN_DB_REMOTA_INTENCIONAL=1 " +
          "— aplicar migraciones sobre la panadería equivocada no tiene deshacer"
      );
    }

    // Misma política TLS que la app, en un solo criterio (ver db.ts politicaTls).
    let ssl;
    if (esLocal) ssl = undefined;
    else if (/\.railway\.internal/.test(url)) ssl = false;
    else if (env.KILOPAN_TLS_SIN_VERIFICAR === "1") ssl = { rejectUnauthorized: false };
    else ssl = { rejectUnauthorized: true };

    const { default: pg } = await import("pg");
    // Las migraciones corren como DUEÑO del esquema, NO como pan_app: crean tablas,
    // triggers, roles y grants. Es el único lugar del sistema donde eso es correcto,
    // y por eso acá no va el `options: -c role=pan_app` que sí lleva la app.
    const client = new pg.Client({
      connectionString: url,
      ssl,
      connectionTimeoutMillis: 15_000, // sin esto, un host mal escrito cuelga sin decir nada
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
    // Aplicar y REGISTRAR en una sola transacción. Son dos viajes de red: contra una
    // BD remota (decenas o cientos de ms de ida y vuelta) un corte entre ambos dejaba
    // la migración aplicada pero sin registrar — y la próxima corrida la reaplicaría
    // sobre un esquema que ya la tiene, fallando con "already exists". Es lo mismo que
    // hacen Flyway y golang-migrate, y por la misma razón.
    await db.exec("begin");
    try {
      await db.exec(sql);
      await db.query(`insert into pan.migraciones_aplicadas (archivo) values ($1)`, [archivo]);
      await db.exec("commit");
    } catch (err) {
      await db.exec("rollback").catch(() => undefined);
      // Se anota QUÉ archivo fue antes de propagar: el catch de arriba solo veía el
      // mensaje pelado y no había forma de saber cuál de las 15 migraciones murió.
      err.archivoMigracion = archivo;
      throw err;
    }
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
    // Postgres manda en `detail` la fila EXACTA que viola el constraint y en `hint`
    // qué hacer; el código los tiraba a la basura y solo imprimía `message`. En el
    // deploy del 26-jul eso costó una investigación entera: el log decía
    // «could not create unique index "rutas_una_activa_por_repartidor_dia"» y había
    // que ir a consultar la base a mano para descubrir CUÁLES filas la rompían.
    // Este contenedor corre `migrar.mjs && server.js`: si la migración falla, la app
    // no arranca — o sea, este mensaje es TODO lo que el que está de guardia va a ver.
    console.error("migrar: FALLÓ:", err.message);
    if (err.archivoMigracion) console.error("  archivo:   ", err.archivoMigracion);
    if (err.detail) console.error("  detalle:   ", err.detail);
    if (err.hint) console.error("  sugerencia:", err.hint);
    if (err.constraint) console.error("  constraint:", err.constraint);
    if (err.table) console.error("  tabla:     ", err.table);
    if (err.code) console.error("  código pg: ", err.code);
    process.exit(1);
  });
}
