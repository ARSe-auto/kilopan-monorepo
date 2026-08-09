#!/usr/bin/env node
// gate-ruts.mjs — cero datos personales reales en seeds [AC-FIDN-21]: §7.8, §9.2, §10.
//
// Busca en el árbol toda cadena con FORMA de RUT y exige que esté en la lista congelada de
// `db/flota/ruts-sinteticos.mjs`. Lo que no está declarado es rojo, sin importar si pasa el
// módulo 11: un RUT real y válido en un seed es exactamente el problema que este gate existe
// para atrapar, y un validador solo diría que está perfecto.
//
// Se busca por FORMA y no por columna: un RUT sembrado puede estar en un `.sql`, en un
// fixture, en un comentario o en el nombre de un archivo, y el §7.8 no distingue.
//
// Uso: node db/flota/gate-ruts.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 un RUT fuera de la lista congelada.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { VALIDOS, INVALIDOS_A_PROPOSITO, declarado } from "./ruts-sinteticos.mjs";

const RAIZ =
  process.argv.find((a) => a.startsWith("--raiz="))?.slice("--raiz=".length) ??
  new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/** Los árboles de FLOTA. Lo de KiloPan tiene su propio gate y no es de esta app. */
const ALCANCE = ["apps/flota", "db/flota", "db/migraciones-flota", "packages/nucleo-comun", "packages/miga"];
const EXTENSIONES = /\.(ts|tsx|mjs|js|sql|json|md)$/;
/** Artefactos de build y dependencias: no son código de nadie. */
const SALTAR = new Set(["node_modules", "test-results", "playwright-report"]);

/** La forma canónica del §0: con puntos de miles y guion. */
const FORMA_DE_RUT = /\b\d{1,3}(?:\.\d{3})+-[\dkK]\b/g;

function archivos(dir, salida = []) {
  if (!existsSync(dir)) return salida;
  if (statSync(dir).isFile()) return EXTENSIONES.test(dir) ? [...salida, dir] : salida;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SALTAR.has(e.name) || e.name.startsWith(".")) continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (EXTENSIONES.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/**
 * Revisa UN archivo. Exportada para que sus mutantes la ejerzan sin tocar el disco del repo.
 * `esLaLista` marca el archivo de la lista congelada, que contiene los RUTs por definición.
 */
export function revisarArchivo(rel, contenido, esLaLista = false) {
  if (esLaLista) return [];
  const problemas = [];
  const lineas = contenido.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    for (const rut of lineas[i].match(FORMA_DE_RUT) ?? []) {
      if (declarado(rut)) continue;
      problemas.push({
        archivo: rel,
        linea: i + 1,
        rut,
        motivo:
          `«${rut}» no está en la lista congelada de RUTs sintéticos. Si es de prueba, ` +
          "agregalo a db/flota/ruts-sinteticos.mjs con la razón de por qué existe; si es de " +
          "una persona real, no puede estar en el repo (§7.8).",
      });
    }
  }
  return problemas;
}

function principal() {
  const LISTA = "db/flota/ruts-sinteticos.mjs";
  const revisados = ALCANCE.flatMap((d) => archivos(join(RAIZ, d)));
  const problemas = revisados.flatMap((ruta) => {
    const rel = relative(RAIZ, ruta);
    return revisarArchivo(rel, readFileSync(ruta, "utf8"), rel === LISTA);
  });

  for (const p of problemas) console.error(`GATE: ${p.archivo}:${p.linea} ${p.motivo}`);
  console.log(
    `gate-ruts: ${Object.keys(VALIDOS).length} válidos + ${Object.keys(INVALIDOS_A_PROPOSITO).length} ` +
      `inválidos declarados × ${revisados.length} archivos en ${ALCANCE.join(", ")} · ` +
      `${problemas.length} problemas`,
  );
  if (revisados.length === 0) {
    console.error("gate-ruts: no se revisó ningún archivo — un verde acá no diría nada");
    return 1;
  }
  if (problemas.length > 0) {
    console.error("gate-ruts: ROJO");
    return 1;
  }
  console.log("gate-ruts: VERDE");
  return 0;
}

if (process.argv[1]?.endsWith("gate-ruts.mjs")) process.exit(principal());
