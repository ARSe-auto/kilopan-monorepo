#!/usr/bin/env node
// gate-seeds-alarm-thermal.mjs — ningún seed/wizard E1 escribe una fila en los ganchos de
// frío. [AC-FMIG-15]
//
// El §4.9 pone `thermal_profile`/`alarm_rule` DDL-only en E1: la tabla existe, sin seeds y sin
// UI (la UI la vigila `gate-ganchos-e1.mjs`, AC-FVEH-14). Lo que ESE gate no mira es el INSERT:
// un seed o el wizard podrían sembrar una fila real de `thermal_profile`/`alarm_rule` sin tocar
// ni una migración ni una pantalla, y el gancho se activaría igual — el §2 métrica 4 («activar
// un vertical = INSERT de filas») es justo el mecanismo que lo permitiría por accidente.
//
// Mismo criterio que los ganchos hermanos del enum de evidencia (`gate-seeds-pin-destinatario.mjs`
// AC-FRUT-20, `gate-seeds-escaneo-codigo.mjs` AC-FPOD-17): el chequeo mira los SEEDS, no la base,
// porque la pérdida real es alguien agregando el INSERT a la plantilla de un vertical o al wizard,
// no una base sucia hoy.
//
// A diferencia de sus hermanos, acá no hay un VALOR de enum que buscar: `thermal_profile` y
// `alarm_rule` son TABLAS enteras. El gate busca el propio `insert into <tabla>` en los árboles
// de siembra — más preciso que buscar el nombre de la tabla a secas, que aparecería también en
// comentarios legítimos y en el DDL que las declara.
//
// Uso: node db/flota/gate-seeds-alarm-thermal.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 alguien sembró una fila, o el gancho se cayó del DDL.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** Los ganchos del §4.9 que en E1 son DDL-only, sin seeds (misma fila de la tabla del §4.9). */
export const GANCHOS = ["thermal_profile", "alarm_rule"];

/** Donde las tablas TIENEN que seguir declaradas. */
export const DONDE_VIVE = "db/migraciones-flota/tenant/0007_ganchos_ddl_only.sql";

/**
 * Dónde puede entrar una siembra. Mismos árboles que los ganchos hermanos del enum de evidencia,
 * más `db/flota` a secas: ahí vive `wizard-onboarding.mjs`, que el AC nombra por su propio texto
 * («ningún seed/WIZARD E1 inserta…»).
 *
 * `db/flota/pgtap` queda FUERA a propósito, mismo motivo que sus hermanos: corre contra
 * `t_canary` dentro de una transacción que se deshace — es como se ejerce que la tabla existe y
 * acepta filas de verdad (AC-FTEN-15), y ninguna de esas filas llega a un tenant.
 */
export const ARBOLES_DE_SIEMBRA = [
  "db/migraciones-flota",
  "db/flota",
  "db/flota/seeds",
  "apps/flota/e2e",
  "apps/flota/src/servidor",
];

const EXTENSIONES = /\.(sql|mjs|ts|tsx|json)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git", "pgtap"]);

function archivos(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (IGNORAR.has(entrada) || entrada.startsWith(".next")) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

/** Quita comentarios de SQL y de JS/TS — nombrar el gancho para explicar por qué NO está
 *  sembrado es legítimo (esta misma familia de archivos lo hace). */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/--.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n");
}

/** ¿Este archivo siembra alguno de los ganchos? Devuelve las líneas ofensoras, 1-indexadas. */
export function siembrasEn(texto) {
  const vivo = sinComentarios(texto);
  const ofensoras = [];
  vivo.split("\n").forEach((linea, i) => {
    for (const gancho of GANCHOS) {
      if (new RegExp(String.raw`insert\s+into\s+${gancho}\b`, "i").test(linea)) {
        ofensoras.push({ linea: i + 1, gancho });
      }
    }
  });
  return ofensoras;
}

let fallo = false;
const problemas = [];
let revisados = 0;
const archivosVistos = new Set();

for (const arbol of ARBOLES_DE_SIEMBRA) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    if (archivosVistos.has(ruta)) continue; // "db/flota" y "db/flota/seeds" se solapan
    archivosVistos.add(ruta);
    revisados++;
    const rel = relative(RAIZ, ruta);
    if (rel === DONDE_VIVE) continue; // el propio DDL las declara — es donde TIENEN que estar
    if (rel.startsWith("db/flota/gate-seeds-alarm-thermal")) continue; // este archivo se nombra a sí mismo
    for (const { linea, gancho } of siembrasEn(readFileSync(ruta, "utf8"))) {
      problemas.push(
        `${rel}:${linea} siembra «${gancho}»: en E1 ese gancho es DDL-only y ningún seed ni ` +
          `wizard lo pone (§4.9, §2 métrica 4). Si de verdad llegó su momento, se decide con el dueño`,
      );
      fallo = true;
    }
  }
}

// El positivo: las dos tablas tienen que SEGUIR declaradas. Sin esto, borrar el DDL pondría este
// gate en verde — y sería el error opuesto: el §4.9 las quiere VIVAS en el esquema para que
// encenderlas sea filas y no una migración.
const ddl = join(RAIZ, DONDE_VIVE);
if (!existsSync(ddl)) {
  problemas.push(`falta ${DONDE_VIVE}: el gate no puede verificar que los ganchos sigan VIVOS`);
  fallo = true;
} else {
  const textoDdl = readFileSync(ddl, "utf8");
  for (const gancho of GANCHOS) {
    if (!new RegExp(String.raw`create\s+table\s+${gancho}\b`, "i").test(textoDdl)) {
      problemas.push(
        `${DONDE_VIVE} ya no declara «create table ${gancho}»: el §4.9 lo quiere VIVO en el ` +
          "esquema para que encenderlo en E2/E3 sean filas y no una migración",
      );
      fallo = true;
    }
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-seeds-alarm-thermal: ${GANCHOS.join(", ")} × ${revisados} archivos de siembra · ` +
    `${problemas.length} problemas`,
);
if (revisados === 0) {
  console.log("gate-seeds-alarm-thermal: SIN ÁRBOLES DE SIEMBRA — no se verificó ningún seed");
}
if (fallo) {
  console.error("gate-seeds-alarm-thermal: ROJO");
  process.exit(1);
}
console.log("gate-seeds-alarm-thermal: VERDE");
