#!/usr/bin/env node
// Mismo bug documentado en apps/kilopan/scripts/correr-tests.mjs: `node --test
// src/**/*.test.ts` en package.json depende de que el shell expanda el glob, y bajo
// `sh -c` (lo que pnpm usa de verdad) `**` sin `globstar` se comporta como `*` de un
// solo nivel — un test dos niveles bajo src/ quedaría afuera EN SILENCIO. Recursivo de
// verdad, con Node mismo. Sin hook de alias `@/`: packages/miga no usa ninguno.
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

function archivosDeTest(dir) {
  const resultado = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre.startsWith(".")) continue;
    const ruta = join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) resultado.push(...archivosDeTest(ruta));
    else if (nombre.endsWith(".test.ts")) resultado.push(ruta);
  }
  return resultado;
}

const archivos = archivosDeTest(join(RAIZ, "src"));
console.log(`correr-tests (miga): ${archivos.length} archivo(s) encontrado(s) recursivamente bajo src/`);
if (archivos.length === 0) process.exit(0);

const resultado = spawnSync(process.execPath, ["--test", ...archivos], {
  cwd: RAIZ,
  stdio: "inherit",
});
process.exit(resultado.status ?? 1);
