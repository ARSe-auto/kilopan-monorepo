#!/usr/bin/env node
// Conecta este repo a un Postgres de Railway, de punta a punta y sin preguntar nada.
// Requiere UNA cosa hecha a mano antes: `railway login` (autenticar una cuenta no es
// algo que un agente deba hacer por ti).
//
//   node db/conectar-railway.mjs
//
// Qué hace, en orden:
//   1. crea el proyecto en Railway (o reusa el que ya esté linkeado)
//   2. agrega el servicio Postgres
//   3. lee la URL PÚBLICA del proxy — la privada (.railway.internal) solo resuelve
//      DENTRO de Railway, así que desde este Mac no sirve para migrar
//   4. escribe .env.local (gitignored) con la política TLS correcta para Railway
//   5. corre el diagnóstico, las migraciones y la semilla
//
// La URL nunca se imprime completa: en pantalla va enmascarada.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL = join(RAIZ, ".env.local");

function railway(args, opciones = {}) {
  return execFileSync("railway", args, {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: opciones.mostrar ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

function enmascarar(url) {
  // postgres://usuario:CLAVE@host:puerto/base -> postgres://usuario:****@host:puerto/base
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@");
}

function paso(n, texto) {
  console.log(`\n[${n}] ${texto}`);
}

// --- 0. ¿autenticado? ------------------------------------------------------
try {
  const quien = railway(["whoami"]).trim();
  console.log(`railway: ${quien}`);
} catch {
  console.error(
    "\nFALTA EL LOGIN. Corre esto en tu terminal y vuelve a lanzar este script:\n\n" +
      "    railway login\n\n" +
      "(se abre el navegador; autenticar una cuenta es algo que tienes que hacer tú)"
  );
  process.exit(1);
}

// --- 1. proyecto -----------------------------------------------------------
paso(1, "Proyecto en Railway");
let yaLinkeado = false;
try {
  const estado = railway(["status", "--json"]);
  const j = JSON.parse(estado);
  console.log(`    ya linkeado: ${j.name ?? "(sin nombre)"}`);
  yaLinkeado = true;
} catch {
  // no linkeado todavía
}

if (!yaLinkeado) {
  console.log("    creando proyecto 'kilopan'...");
  railway(["init", "--name", "kilopan"], { mostrar: true });
}

// --- 2. Postgres -----------------------------------------------------------
paso(2, "Servicio Postgres");
let servicios = [];
try {
  const estado = JSON.parse(railway(["status", "--json"]));
  servicios = (estado.services?.edges ?? []).map((e) => e.node?.name).filter(Boolean);
} catch {
  /* seguimos; si no lo podemos leer, intentamos agregar igual */
}

if (servicios.some((s) => /postgres/i.test(s))) {
  console.log(`    ya existe: ${servicios.find((s) => /postgres/i.test(s))}`);
} else {
  console.log("    agregando Postgres...");
  railway(["add", "--database", "postgres"], { mostrar: true });
}

// --- 3. URL pública --------------------------------------------------------
paso(3, "Leyendo la cadena de conexión");
let vars = {};
for (const nombreServicio of ["Postgres", "postgres"]) {
  try {
    vars = JSON.parse(railway(["variables", "list", "--service", nombreServicio, "--json"]));
    break;
  } catch {
    /* probamos el siguiente */
  }
}

const urlPublica = vars.DATABASE_PUBLIC_URL;
const urlPrivada = vars.DATABASE_URL;

if (!urlPublica) {
  console.error(
    "\nNo se pudo leer DATABASE_PUBLIC_URL del servicio Postgres.\n" +
      "Revisa en el dashboard de Railway que el Postgres tenga el proxy público activo\n" +
      "(servicio Postgres -> Settings -> Networking -> Public Networking)."
  );
  process.exit(1);
}

// node-postgres trata sslmode como alias de verify-full y, peor, si viene en la URL
// DESCARTA el objeto ssl del código. La política vive en politicaTls() (comun/db.ts).
const limpia = (u) => u.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
const publica = limpia(urlPublica);

console.log(`    pública : ${enmascarar(publica)}`);
if (urlPrivada) console.log(`    privada : ${enmascarar(limpia(urlPrivada))}   (para la app desplegada)`);

// --- 4. .env.local ---------------------------------------------------------
paso(4, "Escribiendo .env.local");
if (existsSync(ENV_LOCAL)) {
  copyFileSync(ENV_LOCAL, `${ENV_LOCAL}.respaldo`);
  console.log("    el anterior quedó en .env.local.respaldo");
}

// Se conserva lo que ya estuviera puesto a mano (por ejemplo el secreto del webhook).
const previo = {};
if (existsSync(`${ENV_LOCAL}.respaldo`)) {
  for (const cruda of readFileSync(`${ENV_LOCAL}.respaldo`, "utf8").split("\n")) {
    const m = cruda.replace(/\r$/, "").match(/^([A-Z_]+)=(.*)$/);
    if (m) previo[m[1]] = m[2];
  }
}

writeFileSync(
  ENV_LOCAL,
  `# Generado por db/conectar-railway.mjs — NO commitear (está en .gitignore).

DB_MODE=postgres

# Proxy PÚBLICO de Railway. Es el que sirve desde este Mac: la cadena privada
# (postgres.railway.internal) solo resuelve dentro de la red de Railway.
DATABASE_URL=${publica}

# Apuntar a una BD remota tiene que ser deliberado.
KILOPAN_DB_REMOTA_INTENCIONAL=1

# El certificado del proxy público de Railway es autofirmado con CN=localhost, así que
# la verificación estricta es imposible por construcción. Esto CIFRA pero NO AUTENTICA:
# quedas expuesto a un intermediario que se haga pasar por la base. Aceptable para
# desarrollo; en producción la app usa la red privada, que va cifrada con Wireguard y
# no necesita esto.
KILOPAN_TLS_SIN_VERIFICAR=1

DB_POOL_MAX=5

# Secreto para firmar el webhook del POD (Anexo B). Generar con: openssl rand -hex 32
FLOTA_WEBHOOK_HMAC_SECRET=${previo.FLOTA_WEBHOOK_HMAC_SECRET ?? ""}

NODE_ENV=development
`,
  "utf8"
);
console.log("    OK");

// --- 5. diagnóstico + migraciones + semilla --------------------------------
function correr(script, titulo) {
  paso(titulo[0], titulo[1]);
  try {
    execFileSync("node", [join(RAIZ, "db", script)], { cwd: RAIZ, stdio: "inherit" });
    return true;
  } catch {
    console.error(`\n    FALLÓ ${script} — revisa la salida de arriba.`);
    return false;
  }
}

if (!correr("verificar-conexion.mjs", [5, "Diagnóstico de la conexión"])) process.exit(1);
if (!correr("migrar.mjs", [6, "Migraciones"])) process.exit(1);

// P1 (auditoría 1-ago-2026): antes esto corría sembrar.mjs sin preguntar, siempre —
// incluida la vez en que este script se apunta a un proyecto de Railway que YA tiene
// datos reales (el propio piloto de Indupan). sembrar.mjs no borra nada (usa
// select-antes-de-insertar), pero sí AGREGA cuatro usuarios de demo con PIN «1234» —
// un PIN público, en este mismo archivo, desde hace meses — y un dispositivo con
// secreto «demo», a una base que un panadero real usa. La condición correcta no es
// "¿estamos en producción?" (Railway es SIEMPRE remoto acá) sino "¿esta base ya tiene
// usuarios?" — si los tiene, no es una conexión nueva, es una reconexión a algo que
// alguien ya está usando, y sembrar no es automático nunca más.
paso(7, "¿Corresponde sembrar? (esta base, ¿ya tiene usuarios?)");
const { Client } = await import("pg");
const clienteDiagnostico = new Client({ connectionString: publica, ssl: { rejectUnauthorized: false } });
await clienteDiagnostico.connect();
const yaHayUsuarios = await clienteDiagnostico.query(`select count(*)::int as n from pan.usuarios`);
await clienteDiagnostico.end();

if (yaHayUsuarios.rows[0].n > 0) {
  console.log(
    `    esta base ya tiene ${yaHayUsuarios.rows[0].n} usuario(s) — NO se siembra automáticamente.\n` +
      "    si de verdad quieres agregar los usuarios de demo (PIN 1234) a esta base,\n" +
      "    corre a mano: node db/sembrar.mjs"
  );
} else {
  console.log("    base vacía (0 usuarios) — sembrando datos de demo.");
  if (!correr("sembrar.mjs", [8, "Semilla"])) process.exit(1);
}

console.log(`
=========================================================
KiloPan conectado a Railway.

  Levantar la app contra esa base:
      pnpm --filter kilopan run dev

  Para DESPLEGAR la app en Railway (después, cuando quieras):
      railway up

  Ojo al desplegar: ahí la app tiene que usar la cadena PRIVADA
  (postgres.railway.internal), no la pública. Se configura sola si
  se referencia la variable del servicio Postgres.
=========================================================
`);
