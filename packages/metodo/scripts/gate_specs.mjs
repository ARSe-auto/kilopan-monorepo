#!/usr/bin/env node
// Exige que cada spec en specs/ tenga "Fuente:" y >=3 ACs verificables (PROMPT_MAESTRO.md §9).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SPECS_DIR = new URL("../../../specs", import.meta.url).pathname;

function main() {
  let files;
  try {
    files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    console.log("gate_specs: specs/ no existe todavía — nada que verificar (ok en hito 0).");
    return;
  }
  if (files.length === 0) {
    console.log("gate_specs: specs/ está vacío — nada que verificar todavía.");
    return;
  }

  let failed = false;
  for (const file of files) {
    const path = join(SPECS_DIR, file);
    const text = readFileSync(path, "utf8");
    const hasFuente = /Fuente:/i.test(text);
    const acCount = (text.match(/\[AC-[A-Z0-9-]+\]/g) ?? []).length;
    const ok = hasFuente && acCount >= 3;
    console.log(
      `${ok ? "OK  " : "FAIL"}  ${file}  (Fuente: ${hasFuente ? "sí" : "NO"}, ACs: ${acCount})`
    );
    if (!ok) failed = true;
  }
  if (failed) {
    console.error("gate_specs: FALLÓ — toda spec necesita 'Fuente:' y >=3 ACs.");
    process.exit(1);
  }
  console.log("gate_specs: OK");
}

main();
