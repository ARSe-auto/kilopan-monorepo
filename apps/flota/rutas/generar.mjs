#!/usr/bin/env node
// Generador y guardián del manifiesto de rutas [AC-FTEN-26].
//
//   node rutas/generar.mjs              verifica (lo que corre el gate) y emite el artefacto
//   node rutas/generar.mjs --escribir   regenera rutas/manifiesto.json desde el árbol
//
// Verificar hace tres cosas, en este orden, y la primera que falle aborta:
//   1. DERIVA. Regenera el manifiesto desde `src/app/**` y lo compara con el archivo
//      comiteado. Difieren ⇒ rojo: alguien agregó, movió o borró una ruta y el manifiesto
//      —del que cuelgan las pruebas de AUSENCIA de los módulos 06 y 07— quedó mintiendo.
//   2. AUDITA. Toda ruta con caso de cruce declarado o exención escrita; ninguna exención
//      muerta ni sin justificar (rutas/manifiesto.mjs `auditar`).
//   3. EMITE el contador de exenciones como artefacto del pipeline, con su histórico por
//      commit para que el §10 pueda dibujar la tendencia (creciente = bandera roja).
//
// El artefacto se escribe SIEMPRE, también cuando el paso 2 encuentra problemas: un
// contador que solo se emite en verde no sirve para ver una tendencia, que es justamente lo
// que pasa cuando las exenciones empiezan a subir.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  inventariar,
  componer,
  serializar,
  leerExenciones,
  leerManifiesto,
  auditar,
  emitirCasos,
} from "./manifiesto.mjs";

const AQUI = import.meta.dirname;
const APP = join(AQUI, "..");
const RAIZ = join(APP, "..", "..");
export const RUTA_MANIFIESTO = join(AQUI, "manifiesto.json");
export const RUTA_EXENCIONES = join(AQUI, "exenciones.md");
const PANEL = join(RAIZ, "packages", "metodo", "panel");
const ARTEFACTO = join(PANEL, "exenciones-rutas.json");
const HISTORICO = join(PANEL, "exenciones-rutas.historico.jsonl");

/** Estado actual del manifiesto según el disco. Sin efectos: lo usan el CLI y los tests. */
export function estado({ app = APP } = {}) {
  const inventario = inventariar(join(app, "src", "app"), app);
  const previo = leerManifiesto(join(app, "rutas", "manifiesto.json"));
  const compuesto = componer(inventario, previo);
  const exenciones = existsSync(join(app, "rutas", "exenciones.md"))
    ? leerExenciones(readFileSync(join(app, "rutas", "exenciones.md"), "utf8"))
    : [];
  return { previo, compuesto, exenciones, problemas: auditar(compuesto, exenciones) };
}

/**
 * Los casos que la suite del e2e debe correr, leídos del manifiesto COMITEADO — no de una
 * regeneración al vuelo. Que la suite salga del archivo versionado es lo que hace cierta la
 * frase «autogenerada del manifiesto de rutas»: si leyera el árbol por su cuenta, el archivo
 * que un humano revisa en el PR y lo que de verdad se prueba podrían separarse sin ruido.
 * Que archivo y árbol coincidan lo garantiza el paso 1 de este mismo script.
 */
export function casosDelRepo() {
  const manifiesto = leerManifiesto(RUTA_MANIFIESTO);
  if (!manifiesto) throw new Error("no existe rutas/manifiesto.json: corré `node rutas/generar.mjs --escribir`");
  const exenciones = leerExenciones(readFileSync(RUTA_EXENCIONES, "utf8"));
  return { manifiesto, exenciones, casos: emitirCasos(manifiesto, exenciones) };
}

function shaDeHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: RAIZ, encoding: "utf8" }).trim();
  } catch {
    // Sin git (un tarball, un contenedor de CI sin historia) el artefacto igual se emite:
    // pierde la tendencia, no el contador. Decirlo es mejor que morir por el adorno.
    return "sin-git";
  }
}

/**
 * Artefacto del pipeline: el contador de exenciones y su histórico por commit.
 * El histórico se deduplica por SHA para que veinte corridas del gate sobre el mismo commit
 * no dibujen una tendencia que nadie provocó.
 */
function emitirArtefacto(exenciones, casos) {
  const sha = shaDeHead();
  const registro = {
    ac: "AC-FTEN-26",
    sha,
    exenciones: exenciones.length,
    casos: casos.length,
    rutas_exentas: exenciones.map((e) => e.ruta).sort(),
  };
  writeFileSync(ARTEFACTO, JSON.stringify(registro, null, 2) + "\n");

  const previo = existsSync(HISTORICO) ? readFileSync(HISTORICO, "utf8") : "";
  const yaEsta = previo
    .split("\n")
    .filter(Boolean)
    .some((l) => {
      try {
        return JSON.parse(l).sha === sha;
      } catch {
        return false;
      }
    });
  if (!yaEsta && sha !== "sin-git") appendFileSync(HISTORICO, JSON.stringify(registro) + "\n");
  return registro;
}

function principal(argv) {
  const escribir = argv.includes("--escribir");
  const { previo, compuesto, exenciones, problemas } = estado();
  const texto = serializar(compuesto);

  if (escribir) {
    writeFileSync(RUTA_MANIFIESTO, texto);
    console.log(`manifiesto de rutas: ${compuesto.rutas.length} rutas escritas en rutas/manifiesto.json`);
    const sinDeclarar = compuesto.rutas.filter((r) => !r.cruce).map((r) => r.ruta);
    if (sinDeclarar.length > 0) {
      console.log(
        `  ${sinDeclarar.length} sin caso de cruce declarado: ${sinDeclarar.join(", ")}\n` +
          `  declaralas en rutas/manifiesto.json o eximilas por escrito en rutas/exenciones.md`,
      );
    }
    return 0;
  }

  const enDisco = previo === null ? null : readFileSync(RUTA_MANIFIESTO, "utf8");
  if (enDisco !== texto) {
    console.error(
      "manifiesto de rutas: DESINCRONIZADO del árbol de `src/app/**` [AC-FTEN-26].\n" +
        "  El árbol es la fuente: si una ruta está en el disco, está en el manifiesto — de eso\n" +
        "  dependen las pruebas de ausencia de los módulos 06 y 07 (cero endpoint de emisión de\n" +
        "  DTE, cero línea manual). Regeneralo y revisá el diff:\n" +
        "    node apps/flota/rutas/generar.mjs --escribir",
    );
    emitirArtefacto(exenciones, []);
    return 1;
  }

  const casos = emitirCasos(compuesto, exenciones);
  const registro = emitirArtefacto(exenciones, casos);

  // El contador se IMPRIME siempre, haya o no exenciones. Un contador que solo aparece
  // cuando hay algo que contar es un contador que nadie mira hasta que ya es tarde.
  console.log(
    `manifiesto de rutas [AC-FTEN-26]: ${compuesto.rutas.length} rutas · ${casos.length} casos ` +
      `de cruce · ${registro.exenciones} exenciones` +
      (registro.exenciones > 0 ? ` (${registro.rutas_exentas.join(", ")})` : ""),
  );

  if (problemas.length > 0) {
    console.error(`manifiesto de rutas: ${problemas.length} problemas`);
    for (const p of problemas) console.error(`  - ${p}`);
    return 1;
  }
  return 0;
}

if (process.argv[1]?.endsWith("generar.mjs")) process.exit(principal(process.argv.slice(2)));
