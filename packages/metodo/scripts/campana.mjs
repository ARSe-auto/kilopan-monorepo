#!/usr/bin/env node
// HAD — Hallazgos Auditados Demostrados (docs/PROMPT_CORRECTIVO.md §2).
//
// Un hallazgo está demostrado cuando (1) el ledger acredita que su falsador falló
// ANTES del arreglo y pasa DESPUÉS, y (2) el mutante —revertir SOLO los archivos de
// producción que el arreglo tocó— vuelve a hacerlo fallar HOY, en el HEAD actual. La
// condición 1 es histórica (viene de docs/campana/pruebas.jsonl, escrita a mano por
// quien verificó el arreglo en vivo); la condición 2 se re-ejecuta EN CADA CORRIDA,
// así que una regresión futura que borre el arreglo sin tocar el test lo detecta acá,
// no solo el día que se escribió.
//
// El mutante nunca lo escribe a mano quien reporta el HAD: se DERIVA (git show del
// commit de arreglo, revertido con git apply -R) o viene de un parche estático
// versionado en docs/campana/mutantes/<hallazgo>.patch para los hallazgos cuyo
// arreglo es anterior a esta campaña (no hay commit de ESTA campaña que revertir).
//
// Uso: node packages/metodo/scripts/campana.mjs --had
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ALCANCE_PATH = join(RAIZ, "docs", "campana", "ALCANCE.tsv");
const PRUEBAS_PATH = join(RAIZ, "docs", "campana", "pruebas.jsonl");

function leerAlcance() {
  const lineas = readFileSync(ALCANCE_PATH, "utf8").trim().split("\n");
  const [cabecera, ...filas] = lineas;
  const columnas = cabecera.split("\t");
  return filas.map((linea) => {
    const valores = linea.split("\t");
    return Object.fromEntries(columnas.map((c, i) => [c, valores[i]]));
  });
}

function leerPruebas() {
  const mapa = new Map();
  for (const linea of readFileSync(PRUEBAS_PATH, "utf8").trim().split("\n")) {
    if (!linea.trim()) continue;
    const registro = JSON.parse(linea);
    mapa.set(registro.hallazgo, registro);
  }
  return mapa;
}

function git(args) {
  return execFileSync("git", args, { cwd: RAIZ, encoding: "utf8" }).trim();
}

/** Corre el comando del falsador. Devuelve el exit code, nunca lanza — un falsador que
 *  revienta el proceso es tan válido como uno que sale con código ≠ 0. */
function correr(comando) {
  try {
    execSync(comando, { cwd: RAIZ, stdio: "pipe" });
    return 0;
  } catch (err) {
    return typeof err.status === "number" ? err.status : 1;
  }
}

/** Aplica el mutante (derivado de un commit o de un parche estático), corre el
 *  falsador, y SIEMPRE restaura el árbol antes de devolver el control — pase lo que
 *  pase. Nunca deja el repo mutado si algo lanza a mitad de camino. */
function conMutanteAplicado(registro, fn) {
  const archivos = registro.archivos_mutante ?? [];
  if (archivos.length === 0) {
    return { aplicado: false, motivo: "sin archivos_mutante declarados" };
  }

  // Dos fuentes posibles, probadas en orden — nunca a mano por quien reporta el HAD:
  // (1) derivar del commit de arreglo de ESTA campaña (caso normal); (2) si eso no
  // produce nada —el arreglo es anterior a la campaña, como H-merma-sin-test, cuyo
  // sha_arreglo es el commit del TEST y nunca tocó pesajes/route.ts—, caer al parche
  // estático versionado en docs/campana/mutantes/.
  let parche = null;
  let origenParche = null;
  if (registro.sha_arreglo) {
    try {
      // SIN trim(): un parche necesita su salto de línea final tal cual — recortarlo
      // corrompe el último hunk ("corrupt patch") y `git()` (el helper de arriba)
      // recorta todo por diseño, pensado para salidas de una línea (rev-parse, etc.).
      const candidato = execFileSync("git", ["show", registro.sha_arreglo, "--", ...archivos], {
        cwd: RAIZ,
        encoding: "utf8",
      });
      if (candidato.trim() !== "") {
        parche = candidato;
        origenParche = `derivado de ${registro.sha_arreglo}`;
      }
    } catch {
      /* sha inválido o commit sin ese archivo — se intenta el parche estático abajo */
    }
  }
  const parcheEstatico = join(RAIZ, "docs", "campana", "mutantes", `${registro.hallazgo}.patch`);
  if (!parche && existsSync(parcheEstatico)) {
    parche = readFileSync(parcheEstatico, "utf8");
    origenParche = `parche estático (${parcheEstatico})`;
  }
  if (!parche || parche.trim() === "") {
    return { aplicado: false, motivo: "no se pudo derivar el mutante (¿sha_arreglo inválido o falta el parche estático?)" };
  }

  // Estado limpio ANTES de mutar: si el árbol ya tenía cambios sin comitear en estos
  // archivos, aplicar y revertir un mutante encima sería destructivo con trabajo ajeno.
  const sucio = git(["status", "--porcelain", "--", ...archivos]);
  if (sucio) {
    return { aplicado: false, motivo: `${archivos.join(", ")} tiene cambios sin commitear — no se toca` };
  }

  try {
    execSync("git apply -R --whitespace=nowarn -", { cwd: RAIZ, input: parche, stdio: "pipe" });
  } catch (err) {
    return { aplicado: false, motivo: `el mutante no aplicó limpio (${origenParche}): ${err.message.split("\n")[0]}` };
  }

  try {
    const resultado = fn();
    return { aplicado: true, origenParche, ...resultado };
  } finally {
    // Restauración incondicional: checkout de los archivos exactos que se tocaron.
    execFileSync("git", ["checkout", "--", ...archivos], { cwd: RAIZ });
  }
}

function main() {
  const modo = process.argv.includes("--had") ? "had" : null;
  if (!modo) {
    console.error("campana.mjs: uso — node packages/metodo/scripts/campana.mjs --had");
    process.exit(2);
  }

  const alcance = leerAlcance();
  const pruebas = leerPruebas();

  let demostrados = 0;
  const sinRojoPrevio = [];
  const conMutanteSobreviviente = [];
  const detalle = [];

  for (const item of alcance) {
    const registro = pruebas.get(item.hallazgo_id);
    if (!registro) {
      detalle.push(`  FALTA   ${item.hallazgo_id} — sin entrada en pruebas.jsonl`);
      sinRojoPrevio.push(item.hallazgo_id);
      continue;
    }

    // Condición 1: rojo previo acreditado (o justificado como "arreglo preexistente"
    // — el caso de un hallazgo cuyo fix es anterior a esta campaña).
    const rojoOk = registro.exit_falsador == null ? registro.nota?.includes("anterior a esta campana") : registro.exit_falsador !== 0;
    if (!rojoOk) sinRojoPrevio.push(item.hallazgo_id);

    // Condición 1b: el falsador tiene que estar en VERDE hoy, de verdad, ejecutándolo.
    const exitHoy = correr(registro.comando);
    if (exitHoy !== 0) {
      detalle.push(`  ROJO HOY ${item.hallazgo_id} — el falsador NO pasa contra el HEAD actual (exit ${exitHoy})`);
      continue;
    }

    // Condición 2: el mutante, re-derivado y re-ejecutado AHORA, tiene que matar el
    // falsador (volver a fallar). Si no se puede derivar o no muere, no está demostrado.
    const resultado = conMutanteAplicado(registro, () => ({ exitMutante: correr(registro.comando) }));
    if (!resultado.aplicado) {
      detalle.push(`  SIN MUT. ${item.hallazgo_id} — ${resultado.motivo}`);
      conMutanteSobreviviente.push(item.hallazgo_id);
      continue;
    }
    if (resultado.exitMutante === 0) {
      detalle.push(`  MUT VIVE ${item.hallazgo_id} — el mutante NO hizo fallar el falsador (¿el test dejó de proteger esto?)`);
      conMutanteSobreviviente.push(item.hallazgo_id);
      continue;
    }

    detalle.push(`  OK      ${item.hallazgo_id} — rojo acreditado, verde hoy, mutante muere (${resultado.origenParche})`);
    if (rojoOk) demostrados++;
  }

  console.log(detalle.join("\n"));
  console.log();
  const total = alcance.length;
  const pct = total > 0 ? Math.round((demostrados / total) * 1000) / 10 : 0;
  console.log(`HAD ${pct}% · ${demostrados}/${total} demostrados`);
  if (sinRojoPrevio.length) console.log(`  sin rojo-antes acreditado: ${sinRojoPrevio.join(", ")}`);
  if (conMutanteSobreviviente.length) console.log(`  con mutante sobreviviente o no re-derivable: ${conMutanteSobreviviente.join(", ")}`);

  process.exit(demostrados === total ? 0 : 1);
}

main();
