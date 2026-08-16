#!/usr/bin/env node
// gate_specs.mjs — el contrato existe y es verificable, o no se construye.
//
// Exige, por app: specs/<app>/ existe y NO está vacío; cada spec tiene una línea
// `Fuente: §N` que RESUELVE contra el maestro de esa app; cada spec tiene >=3 ACs
// con formato [AC-FAM-NN]; ningún id de AC duplicado; ningún AC cerrado que diga "falta".
// Y desde el 06-ago-2026: el plan no contradice el contrato — máximo 1 checkbox por AC
// en IMPLEMENTATION_PLAN.md, y su estado espeja el de la spec (la spec manda).
//
// Uso: node gate_specs.mjs [--app=kilopan] [--todas]
// Exit: 0 verde · 1 contrato roto.
//
// HISTORIA (26-jul-2026): este script hacía `return` cuando specs/ no existía o estaba
// vacío ("ok en hito 0"), y NINGÚN script lo invocaba. El motor construyó durante días
// sin criterio de aceptación contra el cual fallar; las tandas A-F de reparación son la
// factura. Un gate que no puede ponerse rojo no es un gate.
//
// HISTORIA (06-ago-2026): el plan acumuló 21 ACs con DOBLE checkbox (el Anexo D y la
// Ola 2 re-listaron ítems sin tocar el original) y el conteo por líneas del plan (69/45)
// divergió del de specs (50/44) hasta hacer dudar del avance real. La regla 5 de abajo
// hace que esa deriva ponga el gate en ROJO el mismo día que nace.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

const MAESTRO = {
  kilopan: "docs/PROMPT_MAESTRO.md",
  flota: "docs/PROMPT_MAESTRO_FLOTA.md",
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

// Acumula ítems `- [x|- [ ]` con sus líneas de continuación (los ítems envuelven varias
// líneas y el id suele ir al final). Contar por línea perdía el 99% de los ACs (bug del
// 26-jul). Las líneas tachadas (`- ~~[x]~~`, historia neutralizada) NO son ítems.
function parseItems(texto) {
  const items = [];
  let actual = null;
  let nLinea = 0;
  for (const linea of texto.split("\n")) {
    nLinea++;
    const inicio = linea.match(/^- \[([ x])\]/);
    if (inicio) {
      if (actual) items.push(actual);
      actual = { estado: inicio[1], texto: linea, linea: nLinea };
    } else if (actual) {
      if (/^(#|- )/.test(linea)) { items.push(actual); actual = null; }
      else actual.texto += " " + linea;
    }
  }
  if (actual) items.push(actual);
  return items;
}

// El id de un ÍTEM es su ÚLTIMO corchete, no el primero. Un ítem puede citar a mitad de
// frase, entre corchetes, el id de OTRO AC de OTRA spec —para decir «mismo diagnóstico
// que allá»— y cerrar recién al final con el SUYO propio, que es como el 99% de los
// ítems de este repo terminan la frase («— oráculo: CI [su-id]»). Esa cita de mitad de
// frase no es el id del ítem: lo es el último corchete. Un primer-match ahí registraba
// la cita ajena como si ESTA spec definiera ese id de OTRA — colisión contra la spec que
// sí lo define — y dejaba el id real del ítem sin registrar: huérfano para verify-refs.
// (Bug real 11-ago-2026, no reproducido acá con AC de ejemplo a propósito: escribir un id
// con FORMA de AC en un comentario lo convierte en una cita que verify-refs recorre igual
// que código — el propio gate se habría puesto rojo por documentarse a sí mismo.)
// Se usa desde dos lugares (specs del AC y el plan), por eso vive acá y no dentro de
// ninguno de los dos bucles.
function idDe(texto) {
  const ms = [...texto.matchAll(/\[(AC-[A-Z0-9]+-\d+)\]/g)];
  return ms.length ? ms[ms.length - 1][1] : null;
}

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
  // README.md documenta el directorio, no es una spec.
  const archivos = readdirSync(dirSpecs)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
  if (archivos.length === 0) {
    err(`${app}: specs/${app}/ está vacío. Sin contrato no se construye.`);
    continue;
  }

  const vistos = new Map(); // id de AC -> archivo que lo define
  const estadoSpec = new Map(); // id de AC -> "x" | " " (estado del checkbox en su spec)
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

    // 2. >=3 ACs con formato [AC-FAM-NN], uno por ÍTEM — no cualquier corchete del archivo
    //    (ver idDe arriba: el id de un ítem es su ÚLTIMO corchete, no el primero).
    const items = parseItems(texto);
    const ids = items.map((item) => idDe(item.texto)).filter(Boolean);
    if (ids.length < 3) err(`${app}/${archivo}: ${ids.length} ACs (mínimo 3)`);

    // 3. ids únicos en todo el conjunto de specs de la app
    for (const id of ids) {
      if (vistos.has(id) && vistos.get(id) !== archivo) {
        err(`${app}: ${id} definido en dos specs (${vistos.get(id)} y ${archivo})`);
      }
      vistos.set(id, archivo);
    }

    // 4. Estado explícito, y un AC cerrado no puede confesar trabajo pendiente.
    for (const item of items) {
      const id = idDe(item.texto);
      if (!id) { err(`${app}/${archivo}: ítem sin id de AC → "${item.texto.trim().slice(0, 60)}…"`); continue; }
      if (item.estado === "x") cerrados++;
      else abiertos++;
      estadoSpec.set(id, item.estado);
      if (item.estado === "x" && /\bfaltan?\b/i.test(item.texto)) {
        err(`${app}/${archivo}: ${id} está marcado [x] pero su texto dice "falta" — pártelo en dos`);
      }
    }
  }

  // 5. El plan no contradice el contrato: máx. 1 checkbox por AC de esta app, y su
  //    estado = el de la spec. (Solo ids que las specs de ESTA app definen: el plan es
  //    compartido y puede listar ACs de otras apps.) Deriva plan↔spec = ROJO hoy, no
  //    descubrimiento arqueológico en 3 semanas.
  const rutaPlan = [`IMPLEMENTATION_PLAN_${app}.md`, "IMPLEMENTATION_PLAN.md"]
    .map((f) => join(ROOT, f)).find(existsSync);
  if (rutaPlan) {
    const porId = new Map(); // id -> [{estado, linea}]
    for (const item of parseItems(readFileSync(rutaPlan, "utf8"))) {
      const id = idDe(item.texto);
      if (!id || !estadoSpec.has(id)) continue; // sin id (histórico) o de otra app
      if (!porId.has(id)) porId.set(id, []);
      porId.get(id).push({ estado: item.estado, linea: item.linea });
    }
    for (const [id, its] of porId) {
      if (its.length > 1) {
        err(`${app}: ${id} tiene ${its.length} checkboxes en el plan (líneas ${its.map((i) => i.linea).join(", ")}) — fusiona en uno; el viejo se tacha (- ~~[x]~~), no se borra`);
      }
      if (its[0].estado !== estadoSpec.get(id)) {
        err(`${app}: ${id} está [${its[0].estado}] en el plan (línea ${its[0].linea}) pero [${estadoSpec.get(id)}] en su spec — la spec manda`);
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
