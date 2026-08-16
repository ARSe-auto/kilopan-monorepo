#!/usr/bin/env node
// Las reglas estáticas del §7.2 con patrón cierto. [AC-FTEN-16]
//
// Cuatro prohibiciones del maestro que ningún test de comportamiento atrapa, porque el código
// que las viola FUNCIONA — anda perfecto hasta el día que cruza datos de dos tenants. Un grep
// bloqueante es la única forma de que no entren.
//
// La quinta exigencia del AC —«backups por BD tenant documentados en el runbook del repo»— no
// es un grep sobre código sino sobre un documento, así que vive donde viven las exigencias de
// documentos: `db/flota/gate-documentos.mjs`.
//
// LA CONVENCIÓN QUE ESTA SPEC FIJA (§7.2, AC-FTEN-16): cache, colas, jobs y logging se tocan
// SOLO a través del wrapper tenant-scoped único del core. El maestro exige que esos cuatro
// planos estén segregados por tenant y no dice cómo verificarlo; la forma de volverlo
// verificable es que exista UN lugar donde se les pone el prefijo del tenant y que usar la API
// cruda fuera de ahí sea rojo. Es el mismo patrón que el grep de `railway` fuera de
// `scripts/deploy.sh` (§9.1).
//
// ALCANCE DECLARADO, nunca silencioso (§10): se revisan los árboles de FLOTA que hoy existen.
// Mientras `apps/flota` no exista, el gate lo DICE en cada corrida en vez de reportar un verde
// que no probó nada — y sus reglas igual están vivas, ejercidas por los fixtures de
// `db/flota/gate-reglas-estaticas.test.mjs`.
//
// Uso: node db/flota/gate-reglas-estaticas.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 alguna regla violada.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/** Dónde vive el wrapper tenant-scoped. Es el ÚNICO lugar donde las APIs crudas se pueden usar. */
export const WRAPPER = "packages/nucleo-comun/src/tenant-scope.ts";

/**
 * La familia canónica de constantes NOMBRA los roles (§0 fila Tenancy: `app_t_<slug>`,
 * `migrator`) y por eso quedaría atrapada por la regla 1. Es DATO y no código de producto —su
 * propio encabezado dice «cero funciones, cero consultas, cero condicionales»— y no abre
 * ninguna conexión. Exenta SOLO de esa regla; las otras tres la siguen revisando.
 */
const CANONICO = "packages/nucleo-comun/src/constants.ts";

const ARBOLES = ["apps/flota/src", "packages/nucleo-comun/src"];
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORAR = new Set(["node_modules", ".next", "dist", "build", ".git"]);

export const REGLAS = [
  {
    id: "privilegio-en-la-conexion-de-la-app",
    // §4.1: la conexión de la app es `app_t_<slug>` — NOSUPERUSER, NOBYPASSRLS, sin ownership.
    // Un rol privilegiado ahí anula de un saque la RLS de dinero y la separación por rol.
    patron: /\b(superuser|bypassrls)\b|['"`]?\b(flota_admin|migrator)\b['"`]?\s*[,)}]|user:\s*['"`](flota_admin|migrator)['"`]/i,
    razon:
      "la conexión de la app usa un rol privilegiado (superuser, BYPASSRLS, flota_admin o " +
      "migrator): el §4.1 exige app_t_<slug> sin ownership",
    exentos: [WRAPPER, CANONICO],
  },
  {
    id: "set-de-sesion",
    // §4.1/§7.2: SET LOCAL siempre. En un pool, un SET de sesión se lo lleva la siguiente
    // transacción de OTRO usuario — y esa transacción hereda el rol de quien no es.
    patron: /set_config\s*\([^)]*,\s*false\s*\)|^\s*(?:await\s+)?[^\n]*\bSET\s+(?!LOCAL\b)app\./im,
    razon:
      "SET de sesión sobre `app.*`: solo SET LOCAL está permitido (§4.1, §7.2). En un pool, " +
      "un SET de sesión se lo lleva la siguiente transacción de otro usuario",
  },
  {
    id: "cross-database-en-runtime",
    // §4.1/§7.2: la agregación cross-tenant va SOLO por el job exportador a `control`.
    patron: /\bdblink\b|\bpostgres_fdw\b|\bCREATE\s+SERVER\b/i,
    razon:
      "consulta cross-database en runtime del producto (dblink/FDW): la agregación va SOLO " +
      "por el job exportador a `control` (§4.1)",
  },
  {
    id: "api-cruda-fuera-del-wrapper",
    // La convención que vuelve verificable la segregación por tenant de cache, colas, jobs y
    // logging (§7.2). Ver el encabezado.
    patron:
      /\bnew\s+Redis\b|\bfrom\s+['"`](ioredis|redis|bullmq|node-cron)['"`]|\bnew\s+Queue\b|\bcron\.schedule\b|\bconsole\.(log|error|warn|info)\s*\(/,
    razon:
      "uso directo de una API cruda de cache, colas, jobs o logging fuera del wrapper " +
      `tenant-scoped (${WRAPPER}): sin el prefijo del tenant, esos cuatro planos se cruzan (§7.2)`,
    exentos: [WRAPPER],
  },
  {
    id: "plano-eauto-sin-bd-de-tenant",
    // Spec 05 §3/§4.1: el Plano B de e-auto lee EXCLUSIVAMENTE de `control`. A diferencia de
    // las reglas de arriba (§7.2, todo `apps/flota/src`), esta es de ALCANCE ACOTADO: el resto
    // de la app SÍ tiene que poder conectarse a BDs de tenant (`t_<slug>`) para operar — es la
    // vista cross-tenant, y solo ella, la que jamás puede [AC-FSEM-10].
    soloEn: ["apps/flota/src/dominio/plano-eauto.ts", "apps/flota/src/plano-eauto"],
    patron: /\bbdDeTenant\s*\(|poolDe\s*\(\s*['"`]t_|['"`]t_\$\{|from\s+['"`][^'"`]*servidor\/conexion[^'"`]*['"`]/,
    razon:
      "el plano cross-tenant de e-auto referenció una BD t_<slug> o el pool del servidor de " +
      "tenant: el Plano B lee EXCLUSIVAMENTE de `control` (§3, §4.1)",
  },
];

function archivos(raiz) {
  const salida = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir).sort()) {
      if (IGNORAR.has(entrada)) continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  for (const arbol of ARBOLES) {
    const dir = join(raiz, arbol);
    if (existsSync(dir)) recorrer(dir);
  }
  return salida;
}

/** Devuelve `{ problemas, revisados, arbolesPresentes }`. */
export function revisar(raiz = RAIZ_REPO, reglas = REGLAS) {
  const revisados = archivos(raiz);
  const problemas = [];
  for (const ruta of revisados) {
    const rel = relative(raiz, ruta);
    const texto = readFileSync(ruta, "utf8");
    for (const regla of reglas) {
      if (regla.exentos?.includes(rel)) continue;
      // `soloEn`: la regla es de alcance ACOTADO a ciertos archivos/directorios (prefijo de
      // ruta relativa a la raíz), no a los ARBOLES completos. Sin esto, cada regla nueva
      // tendría que ser global o exentar cada archivo restante uno por uno — al revés de lo
      // que hace falta acá, donde la excepción es la regla y el resto de la app opera normal.
      if (regla.soloEn && !regla.soloEn.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      const lineas = texto.split("\n");
      for (let i = 0; i < lineas.length; i++) {
        // Los comentarios no son código: una regla que se dispara con su propia explicación
        // es una regla que alguien apaga a la semana.
        const linea = lineas[i].replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (regla.patron.test(linea)) {
          problemas.push(`${rel}:${i + 1} — ${regla.razon}`);
          break;
        }
      }
    }
  }
  return {
    problemas,
    revisados: revisados.map((r) => relative(raiz, r)),
    arbolesPresentes: ARBOLES.filter((a) => existsSync(join(raiz, a))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1] ?? RAIZ_REPO;
  const { problemas, revisados, arbolesPresentes } = revisar(raiz);
  for (const p of problemas) console.error(`GATE: ${p}`);
  console.log(
    `gate-reglas-estaticas: ${REGLAS.length} reglas × ${revisados.length} archivos en ` +
      `${arbolesPresentes.join(", ") || "(ningún árbol todavía)"} · ${problemas.length} problemas`,
  );
  if (revisados.length === 0) {
    // Verde vacuo declarado (docs/LECCION_RALPH.md): sin código de producto, este gate no
    // revisó nada. Sus reglas siguen vivas en los fixtures de su propia suite.
    console.log(
      "gate-reglas-estaticas: SIN CÓDIGO DE PRODUCTO TODAVÍA — no se revisó ningún archivo; " +
        "las reglas se ejercen contra fixtures en db/flota/gate-reglas-estaticas.test.mjs",
    );
  }
  if (problemas.length > 0) {
    console.error("gate-reglas-estaticas: ROJO");
    process.exit(1);
  }
  console.log("gate-reglas-estaticas: VERDE");
  process.exit(0);
}
