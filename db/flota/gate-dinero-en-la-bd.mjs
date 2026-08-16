#!/usr/bin/env node
// gate-dinero-en-la-bd.mjs — la aritmética de dinero vive en la BD. [AC-FTAR-03]
//
// El §4.8 y el §7.5 piden dos cosas sobre el dinero: que sea CLP entero (jamás float) y que se
// calcule EN LA BASE. La primera mitad ya la vigilan el linter de migraciones (toda columna
// `*_clp` es `bigint`) y la suite pgTAP del catálogo (AC-FTEN-09). Esta es la segunda mitad, y
// es la que ningún test de base puede atrapar: una multiplicación de pesos escrita en
// TypeScript compila, pasa los tipos y da un número plausible.
//
// EL DEFECTO QUE PREVIENE TIENE NOMBRE: dos totales que no coinciden. La pantalla suma las
// líneas en JavaScript «para no ir a la base otra vez», la BD las suma con `round_clp()`, y el
// día que un modificador deje de ser un entero los dos números se separan por un peso. Con el
// drill-down del §3.E1.9 delante de un cliente que está reclamando una factura, ese peso es la
// diferencia entre cobrar y discutir.
//
// CÓMO DECIDE. Un símbolo de dinero es el que la convención del repo ya usa: un identificador
// terminado en `_clp` o en `Clp`. Fuera de la BD, NOMBRARLO está permitido en todas partes —una
// columna en una consulta, un campo de un payload, una aserción de un test—; lo que no está
// permitido es OPERAR con él (`* / + -`) ni pasarlo por un flotante (`parseFloat`, `toFixed`).
//
// Uso: node db/flota/gate-dinero-en-la-bd.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 hay aritmética de dinero fuera de la BD, o el catálogo está vacío.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const RAIZ = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1] ?? RAIZ_REPO;

/** Donde el dinero SÍ se calcula: las migraciones del tenant, que son la BD. */
export const DIR_BD = "db/migraciones-flota";

/** Los árboles de código de aplicación, que están FUERA de la BD. */
const ARBOLES = ["apps/flota", "packages/nucleo-comun", "packages/miga"];
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);
const esArtefacto = (nombre) => IGNORAR.has(nombre) || nombre.startsWith(".next");

/**
 * Este gate y sus mutantes nombran y operan símbolos de dinero a propósito: para buscarlos hay
 * que escribirlos, y para probar que el gate dispara hay que plantar el defecto. Armar las
 * muestras por concatenación para esquivar el propio grep habría dejado un test ilegible.
 */
const EXENTOS = new Set(["db/flota/gate-dinero-en-la-bd.mjs", "db/flota/gate-dinero-en-la-bd.test.mjs"]);

/** Un identificador de dinero, en las dos convenciones del repo: `monto_clp` y `montoClp`. */
const SIMBOLO = String.raw`(?:[a-z_][a-z0-9_]*_clp|[a-zA-Z_$][a-zA-Z0-9_$]*Clp)`;

/** Quita comentarios de línea y de bloque, que son prosa y no código. */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * ¿Esta línea CALCULA con dinero, o solo lo nombra?
 *
 * Calcula si el símbolo tiene un operador aritmético a un lado, o si pasa por un flotante.
 * `monto_clp: 3500` y `select monto_clp from …` no calculan nada; `total + monto_clp` sí.
 * El `+` cuenta igual que el `*`: sumar pesos en el cliente es exactamente el total paralelo
 * que este gate existe para impedir.
 */
export function calculaConDinero(linea) {
  const aritmetica = new RegExp(
    String.raw`(?:[*/+]\s*|\s-\s*)${SIMBOLO}\b|\b${SIMBOLO}\s*(?:[*/+]|\s-\s|\+\+|--)`,
  );
  if (aritmetica.test(linea)) return "aritmética";
  const flotante = new RegExp(
    String.raw`(?:parseFloat|Number\.parseFloat)\s*\([^)]*${SIMBOLO}|${SIMBOLO}[^;\n]*\.toFixed\s*\(`,
  );
  if (flotante.test(linea)) return "flotante";
  return null;
}

function archivos(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (esArtefacto(entrada)) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

/** Los hallazgos de un árbol, ya relativos a la raíz. Exportada para los mutantes. */
export function revisar(raiz = RAIZ, arboles = ARBOLES) {
  const hallazgos = [];
  let revisados = 0;
  for (const arbol of arboles) {
    for (const ruta of archivos(join(raiz, arbol))) {
      const rel = relative(raiz, ruta);
      if (EXENTOS.has(rel)) continue;
      revisados++;
      sinComentarios(readFileSync(ruta, "utf8"))
        .split("\n")
        .forEach((linea, i) => {
          const clase = calculaConDinero(linea);
          if (clase) hallazgos.push({ rel, linea: i + 1, clase });
        });
    }
  }
  return { hallazgos, revisados };
}

// --- CLI -------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let fallo = false;

  // Verde vacuo prohibido: sin `round_clp()` en las migraciones, «el dinero se calcula en la
  // BD» sería una frase sin implementación y este gate pasaría vigilando nada.
  const dirBd = join(RAIZ, DIR_BD);
  const hayRedondeo = existsSync(dirBd)
    ? archivosSql(dirBd).some((r) => /function\s+round_clp\s*\(/.test(readFileSync(r, "utf8")))
    : false;
  if (!hayRedondeo) {
    console.error(`GATE: no existe round_clp() en ${DIR_BD}: el dinero no se calcula en ninguna parte`);
    fallo = true;
  }

  const { hallazgos, revisados } = revisar();
  for (const h of hallazgos) {
    console.error(
      `GATE: ${h.rel}:${h.linea} hace ${h.clase} con un símbolo de dinero fuera de la BD — ` +
        "el monto lo calcula la base con round_clp() (§4.8, §7.5)",
    );
    fallo = true;
  }

  console.log(
    `gate-dinero-en-la-bd: ${revisados} archivos de ${ARBOLES.join(", ")} · ` +
      `${hallazgos.length} cálculos de dinero fuera de la BD`,
  );
  if (fallo) {
    console.error("gate-dinero-en-la-bd: ROJO");
    process.exit(1);
  }
  console.log("gate-dinero-en-la-bd: VERDE");
}

/** Los .sql de un directorio, recursivo. Solo lo usa el chequeo de `round_clp()`. */
function archivosSql(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (entrada.endsWith(".sql")) salida.push(ruta);
    }
  };
  recorrer(dir);
  return salida;
}
