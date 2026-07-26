#!/usr/bin/env node
// gate_specs.mjs — el contrato existe y es verificable, o no se construye.
//
// Exige, por app: specs/<app>/ existe y NO está vacío; cada spec tiene una línea
// `Fuente: §N` que RESUELVE contra el maestro de esa app; cada spec tiene >=3 ACs
// con formato [AC-FAM-NN]; ningún id de AC duplicado; ningún AC cerrado que diga "falta".
//
// Uso: node gate_specs.mjs [--app=kilopan] [--todas]
// Exit: 0 verde · 1 contrato roto.
//
// HISTORIA (26-jul-2026): este script hacía `return` cuando specs/ no existía o estaba
// vacío ("ok en hito 0"), y NINGÚN script lo invocaba. El motor construyó durante días
// sin criterio de aceptación contra el cual fallar; las tandas A-F de reparación son la
// factura. Un gate que no puede ponerse rojo no es un gate.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

const MAESTRO = {
  kilopan: "docs/PROMPT_MAESTRO.md",
  flota: "docs/PROMPT_MAESTRO_KILORUTA.md",
};

const args = process.argv.slice(2);
const todas = args.includes("--todas");
const appArg = args.find((a) => a.startsWith("--app="))?.split("=")[1];
const apps = todas ? Object.keys(MAESTRO) : [appArg ?? "kilopan"];

let fallo = false;
const err = (msg) => {
  console.error(`GATE: ${msg}`);
  fallo = true;
};

for (const app of apps) {
  const dirSpecs = join(ROOT, "specs", app);
  const rutaMaestro = MAESTRO[app];

  if (!rutaMaestro) {
    err(`app desconocida '${app}' (conocidas: ${Object.keys(MAESTRO).join(", ")})`);
    continue;
  }
  if (!existsSync(join(ROOT, rutaMaestro))) {
    err(`${app}: falta el maestro ${rutaMaestro} — las specs no tienen contra qué resolver`);
    continue;
  }
  const maestro = readFileSync(join(ROOT, rutaMaestro), "utf8");

  if (!existsSync(dirSpecs)) {
    err(`${app}: specs/${app}/ no existe. Sin contrato no se construye.`);
    continue;
  }
  const archivos = readdirSync(dirSpecs).filter((f) => f.endsWith(".md")).sort();
  if (archivos.length === 0) {
    err(`${app}: specs/${app}/ está vacío. Sin contrato no se construye.`);
    continue;
  }

  const vistos = new Map(); // id de AC -> archivo que lo define
  let abiertos = 0;
  let cerrados = 0;

  for (const archivo of archivos) {
    const texto = readFileSync(join(dirSpecs, archivo), "utf8");

    // 1. Fuente: §N que resuelva como encabezado real del maestro
    const fuente = texto.match(/^Fuente:\s*§(\d+(?:\.\d+)?)/m)?.[1];
    if (!fuente) {
      err(`${app}/${archivo}: sin línea 'Fuente: §N'`);
    } else {
      // El maestro titula sus secciones `## N. TÍTULO` (y las sub como `### N.M`).
      const n = fuente.replace(".", "\\.");
      const anclado = new RegExp(`^#+\\s*${n}(?:\\.(?=\\s)|\\b)(?!\\d)`, "m");
      if (!anclado.test(maestro)) {
        err(`${app}/${archivo}: cita §${fuente}, ausente de ${rutaMaestro}`);
      }
    }

    // 2. >=3 ACs con formato [AC-FAM-NN]
    const ids = [...texto.matchAll(/\[(AC-[A-Z0-9]+-\d+)\]/g)].map((m) => m[1]);
    if (ids.length < 3) err(`${app}/${archivo}: ${ids.length} ACs (mínimo 3)`);

    // 3. ids únicos en todo el conjunto de specs de la app
    for (const id of ids) {
      if (vistos.has(id) && vistos.get(id) !== archivo) {
        err(`${app}: ${id} definido en dos specs (${vistos.get(id)} y ${archivo})`);
      }
      vistos.set(id, archivo);
    }

    // 4. Estado explícito, y un AC cerrado no puede confesar trabajo pendiente.
    //    Los ítems envuelven varias líneas: se acumula desde `- [x]` hasta el próximo
    //    ítem o encabezado. Contar por línea perdía el 99% de los ACs (bug del 26-jul).
    const items = [];
    let actual = null;
    for (const linea of texto.split("\n")) {
      const inicio = linea.match(/^- \[([ x])\]/);
      if (inicio) {
        if (actual) items.push(actual);
        actual = { estado: inicio[1], texto: linea };
      } else if (actual) {
        if (/^(#|- )/.test(linea)) { items.push(actual); actual = null; }
        else actual.texto += " " + linea;
      }
    }
    if (actual) items.push(actual);

    for (const item of items) {
      const id = item.texto.match(/\[(AC-[A-Z0-9]+-\d+)\]/)?.[1];
      if (!id) { err(`${app}/${archivo}: ítem sin id de AC → "${item.texto.trim().slice(0, 60)}…"`); continue; }
      if (item.estado === "x") cerrados++;
      else abiertos++;
      if (item.estado === "x" && /\bfaltan?\b/i.test(item.texto)) {
        err(`${app}/${archivo}: ${id} está marcado [x] pero su texto dice "falta" — pártelo en dos`);
      }
    }
  }

  console.log(
    `gate_specs [${app}]: ${archivos.length} specs · ${vistos.size} ACs (${cerrados} cerrados, ${abiertos} abiertos)`
  );
}

if (fallo) {
  console.error("gate_specs: ROJO — specs primero.");
  process.exit(1);
}
console.log("gate_specs: VERDE");
