#!/usr/bin/env node
// Diagnóstico de la conexión a Postgres. Corre ANTES de migrar contra un host nuevo.
//
// No supone nada sobre el proveedor: prueba cada cosa que las migraciones de KiloPan
// necesitan y reporta qué encontró. Está escrito para responder empíricamente las
// preguntas que uno se hace al conectar a un hospedado por primera vez —sobre todo
// si el TLS valida contra las CAs del sistema o no—, en vez de discutirlo a ciegas.
//
//   node db/verificar-conexion.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

function env() {
  const e = { ...process.env };
  const path = join(RAIZ, ".env.local");
  if (existsSync(path)) {
    for (const linea of readFileSync(path, "utf8").split("\n")) {
      const m = linea.match(/^([A-Z_]+)=(.*)$/);
      if (m && !e[m[1]]) e[m[1]] = m[2];
    }
  }
  return e;
}

function ocultarClave(url) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:••••@");
}

async function probar(nombre, fn) {
  try {
    const detalle = await fn();
    console.log(`  OK    ${nombre}${detalle ? ` — ${detalle}` : ""}`);
    return { nombre, ok: true, detalle };
  } catch (err) {
    // Los errores de red de `pg` a veces llegan con message vacío y toda la
    // información en `code` (ECONNREFUSED, ENOTFOUND, SELF_SIGNED_CERT_IN_CHAIN).
    // Un diagnóstico que dice "FALLA —" y nada más no sirve para nada.
    const partes = [err?.message, err?.code, err?.errno && `errno ${err.errno}`].filter(Boolean);
    const msg = partes.length ? partes.join(" / ") : "sin detalle del driver";
    console.log(`  FALLA ${nombre} — ${msg}`);
    return { nombre, ok: false, error: msg };
  }
}

async function conectarCon(pg, url, ssl, etiqueta) {
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 12_000 });
  await client.connect();
  const r = await client.query("select version()");
  await client.end();
  return { etiqueta, version: r.rows[0].version.split(",")[0] };
}

async function main() {
  const e = env();
  const url = e.DATABASE_URL;
  if (!url) {
    console.error("Falta DATABASE_URL en .env.local o en el entorno.");
    process.exit(1);
  }

  console.log(`\nProbando: ${ocultarClave(url)}\n`);
  const { default: pg } = await import("pg");
  const esLocal = /localhost|127\.0\.0\.1/.test(url);

  // ---------------------------------------------------------------------
  // 1. TLS: la pregunta que de verdad importa. ¿El certificado del proveedor
  //    valida contra las CAs raíz del sistema, o es autofirmado?
  // ---------------------------------------------------------------------
  console.log("TLS");
  let modoSslQueFunciona = null;

  if (esLocal) {
    console.log("  (host local: TLS no aplica)");
    const alcanzable = await probar("el servidor responde", () =>
      conectarCon(pg, url, undefined, "local").then((r) => r.version)
    );
    if (!alcanzable.ok) {
      console.error("\nNo hay un Postgres escuchando en esa dirección.");
      console.error("Si quieres desarrollar sin instalar nada, usa DB_MODE=pglite.");
      process.exit(1);
    }
    modoSslQueFunciona = "sin-tls";
  } else {
    const estricto = await probar("verificación estricta de certificado (rejectUnauthorized: true)", () =>
      conectarCon(pg, url, { rejectUnauthorized: true }, "estricto").then((r) => r.version)
    );
    if (estricto.ok) {
      modoSslQueFunciona = "estricto";
    } else {
      const laxo = await probar(
        "TLS cifrado pero SIN verificar el certificado (rejectUnauthorized: false)",
        () => conectarCon(pg, url, { rejectUnauthorized: false }, "laxo").then((r) => r.version)
      );
      if (laxo.ok) {
        modoSslQueFunciona = "laxo";
        console.log("");
        console.log("  ⚠  El certificado de este host NO valida contra las CAs del sistema.");
        console.log("     La conexión se puede cifrar igual, pero sin verificar el certificado");
        console.log("     quedas expuesto a un intermediario que se haga pasar por la BD.");
        console.log("     Por acá viajan RUTs, PINs hasheados y evidencia de entregas.");
        console.log("     Antes de aceptarlo: busca si el proveedor publica su CA para");
        console.log("     verificación estricta (ssl.ca), que es la salida correcta.");
      }
    }
  }

  if (!modoSslQueFunciona) {
    console.error("\nNo se pudo conectar de ninguna forma. Revisa la URL, el firewall y que la BD esté viva.");
    process.exit(1);
  }

  const ssl =
    modoSslQueFunciona === "sin-tls"
      ? undefined
      : { rejectUnauthorized: modoSslQueFunciona === "estricto" };

  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 12_000 });
  await client.connect();

  // ---------------------------------------------------------------------
  // 2. Lo que las migraciones de KiloPan necesitan sí o sí.
  // ---------------------------------------------------------------------
  console.log("\nCapacidades que exigen las migraciones");

  const resultados = [];
  resultados.push(
    await probar("versión de Postgres ≥ 14", async () => {
      const r = await client.query("show server_version");
      const mayor = Number(r.rows[0].server_version.split(".")[0]);
      if (mayor < 14) throw new Error(`es ${r.rows[0].server_version}`);
      return r.rows[0].server_version;
    })
  );
  resultados.push(
    await probar("usuario con permiso para CREATE EXTENSION", async () => {
      const r = await client.query("select rolsuper, rolcreatedb, rolcreaterole, current_user from pg_roles where rolname = current_user");
      const f = r.rows[0];
      return `${f.current_user} (superusuario: ${f.rolsuper ? "sí" : "no"}, crea roles: ${f.rolcreaterole ? "sí" : "no"})`;
    })
  );
  resultados.push(
    await probar("extensión pgcrypto (gen_random_uuid)", async () => {
      await client.query("create extension if not exists pgcrypto");
      const r = await client.query("select gen_random_uuid() as id");
      return r.rows[0].id.slice(0, 8) + "…";
    })
  );
  resultados.push(
    await probar("extensión btree_gist (EXCLUDE de sesiones)", async () => {
      await client.query("create extension if not exists btree_gist");
      return "disponible";
    })
  );
  resultados.push(
    await probar("CREATE ROLE (necesario para pan_app, mínimo privilegio)", async () => {
      await client.query("do $$ begin if not exists (select 1 from pg_roles where rolname='kp_prueba_rol') then create role kp_prueba_rol; end if; end $$");
      await client.query("drop role if exists kp_prueba_rol");
      return "puede crear y borrar roles";
    })
  );
  resultados.push(
    await probar("SET ROLE (AC-SEC-08: la app nunca corre como dueño)", async () => {
      await client.query("do $$ begin if not exists (select 1 from pg_roles where rolname='pan_app') then create role pan_app login; end if; end $$");
      await client.query("set role pan_app");
      const r = await client.query("select current_user");
      await client.query("reset role");
      return `current_user pasa a ${r.rows[0].current_user}`;
    })
  );

  // ---------------------------------------------------------------------
  // 3. Límites que definen el tamaño del pool.
  // ---------------------------------------------------------------------
  console.log("\nLímites del servidor");
  const limites = await client.query(`
    select
      current_setting('max_connections') as max_conexiones,
      (select count(*)::text from pg_stat_activity) as en_uso,
      current_setting('statement_timeout') as statement_timeout
  `);
  const l = limites.rows[0];
  console.log(`  max_connections: ${l.max_conexiones} (en uso ahora: ${l.en_uso})`);
  console.log(`  statement_timeout del servidor: ${l.statement_timeout}`);

  const poolSugerido = Math.max(2, Math.min(10, Math.floor(Number(l.max_conexiones) * 0.25)));
  console.log(`  → DB_POOL_MAX sugerido: ${poolSugerido}`);
  console.log(`    (una fracción del total: hay que dejar aire para migraciones, respaldos y`);
  console.log(`     para ti conectándote con un cliente a mirar)`);

  await client.end();

  // ---------------------------------------------------------------------
  const fallas = resultados.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(60));
  if (fallas.length > 0) {
    console.log(`RESULTADO: ${fallas.length} capacidad(es) faltante(s). No migres todavía.`);
    for (const f of fallas) console.log(`  - ${f.nombre}`);
    process.exit(1);
  }

  console.log("RESULTADO: este Postgres sirve para KiloPan.");
  console.log("");
  console.log("Pon en .env.local:");
  console.log("  DB_MODE=postgres");
  console.log("  KILOPAN_DB_REMOTA_INTENCIONAL=1");
  console.log(`  DB_POOL_MAX=${poolSugerido}`);
  if (modoSslQueFunciona === "laxo") {
    console.log("  KILOPAN_TLS_SIN_VERIFICAR=1   # decisión consciente: ver la advertencia de arriba");
  }
  console.log("");
  console.log("Después:  node db/migrar.mjs  &&  node db/sembrar.mjs");
  console.log("=".repeat(60) + "\n");
}

main().catch((err) => {
  console.error("\nverificar-conexion: error inesperado:", err.message);
  process.exit(1);
});
