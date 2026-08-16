#!/usr/bin/env node
// Arnés de pgTAP: corre las suites de `db/flota/pgtap/` contra una BD de tenant.
//
// Varias specs de FLOTA piden pgTAP por su nombre (AC-FTEN-08 catálogo de PKs, 09 tipado de
// dinero, 12 estructura, 14 ausencia de constraints). El motivo es que esas verificaciones
// son sobre el CATÁLOGO —qué columnas existen, con qué tipo y qué DEFAULT—, y escribirlas
// dentro de la base es lo único que no puede quedar desfasado de la base.
//
// Cada suite corre dentro de una transacción que SIEMPRE se revierte: los tests insertan
// filas de verdad —es la única forma de probar que el servidor genera la PK— y no tienen por
// qué dejarlas. `pgtap` se crea como extensión en la misma transacción.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { conectar, TENANT_CANARIO, bdDeTenant } from "./conectar.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const DIR_PGTAP = join(RAIZ, "db/flota/pgtap");

/** Las líneas TAP que devolvió una suite, ya desenvueltas de sus filas. */
function lineasTap(resultados) {
  const lista = Array.isArray(resultados) ? resultados : [resultados];
  return lista
    .flatMap((r) => r?.rows ?? [])
    .map((fila) => Object.values(fila)[0])
    .filter((v) => typeof v === "string")
    .flatMap((v) => v.split("\n"));
}

/**
 * Lee TAP y devuelve `{ total, ok, fallidos, diagnosticos }`.
 *
 * Se cuenta a partir de las líneas `ok`/`not ok` y NO del plan: un `finish()` que nunca llega
 * porque una consulta murió dejaría el plan escrito y la suite sin correr.
 */
export function leerTap(lineas) {
  const fallidos = [];
  const diagnosticos = [];
  let total = 0;
  let ok = 0;
  for (const linea of lineas) {
    const m = /^(not ok|ok)\b\s*(\d+)?\s*-?\s*(.*)$/.exec(linea.trim());
    if (m) {
      total++;
      if (m[1] === "ok") ok++;
      else fallidos.push(m[3] || `prueba ${m[2] ?? total}`);
      continue;
    }
    if (/^#/.test(linea.trim())) diagnosticos.push(linea.trim());
  }
  return { total, ok, fallidos, diagnosticos };
}

/** Corre UNA suite. Devuelve el veredicto; nunca deja filas en la base. */
export async function correrSuite(bd, ruta) {
  const conexion = await conectar(bd);
  try {
    await conexion.cliente.query("begin");
    await conexion.cliente.query("create extension if not exists pgtap");
    const resultados = await conexion.cliente.query(readFileSync(ruta, "utf8"));
    return leerTap(lineasTap(resultados));
  } finally {
    await conexion.cliente.query("rollback").catch(() => {});
    await conexion.cerrar();
  }
}

export function suitesDe(dir = DIR_PGTAP) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Corre todas las suites contra el canario: es un tenant de verdad, provisionado desde la
 * plantilla igual que los demás, así que el catálogo que se verifica es el que le va a tocar
 * a un cliente — y no el de una base de juguete armada para el test.
 */
export async function correrTodas({ bd = bdDeTenant(TENANT_CANARIO), dir = DIR_PGTAP } = {}) {
  const suites = suitesDe(dir);
  const resultados = [];
  for (const ruta of suites) resultados.push({ ruta, ...(await correrSuite(bd, ruta)) });
  return { bd, resultados };
}

// --- CLI -------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  correrTodas()
    .then(({ bd, resultados }) => {
      let fallo = resultados.length === 0;
      if (fallo) console.error("GATE: no hay ninguna suite pgTAP en db/flota/pgtap/");
      for (const r of resultados) {
        const nombre = r.ruta.replace(`${RAIZ}/`, "");
        console.log(`pgtap [${bd}] ${nombre}: ${r.ok}/${r.total}`);
        for (const d of r.diagnosticos) console.log(`  ${d}`);
        for (const f of r.fallidos) console.error(`GATE: ${nombre} — ${f}`);
        // Cero pruebas es rojo, no verde: una suite que no corrió no probó nada.
        if (r.total === 0 || r.fallidos.length > 0) fallo = true;
      }
      if (fallo) {
        console.error("pgtap: ROJO");
        process.exit(1);
      }
      console.log("pgtap: VERDE");
      process.exit(0);
    })
    .catch((e) => {
      console.error(`pgtap: ${e.message}`);
      process.exit(1);
    });
}
