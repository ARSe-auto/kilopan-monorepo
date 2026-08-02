#!/usr/bin/env node
// P1 (auditoría 1-ago-2026): `node --test src/**/*.test.ts` en package.json dependía de
// que el SHELL expandiera el glob — bajo `sh -c` (lo que pnpm usa de verdad) `**` sin
// `globstar` se comporta como `*` de un solo nivel. Hoy funciona de pura casualidad
// (los 5 archivos *.test.ts existentes están exactamente un nivel bajo src/); el primer
// test que alguien agregue dos niveles más abajo (por ejemplo
// src/app/api/algo/route.test.ts) se queda afuera EN SILENCIO — pnpm test seguiría
// saliendo verde sin haber corrido esa prueba ni una vez.
//
// Este script encuentra los archivos con Node mismo (recursivo de verdad, sin
// depender del shell que invoque pnpm) y además registra el hook de alias `@/`
// (scripts/resolver-alias-hooks.mjs) SIEMPRE — antes, cualquier test que importara
// código real vía `@/...` (como src/pod/sincronizar-rechazo.test.ts) fallaba bajo
// `pnpm test` con "Cannot find package '@/...'" y nadie lo hubiera notado corriendo
// el comando "de la forma normal": había que saber pasarle `--import` a mano.
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
if (archivos.length === 0) {
  console.error("correr-tests: no se encontró ni un solo *.test.ts bajo src/ — ¿cwd equivocado?");
  process.exit(1);
}
console.log(`correr-tests: ${archivos.length} archivo(s) encontrados recursivamente bajo src/`);

const resultado = spawnSync(
  process.execPath,
  ["--import", "./scripts/resolver-alias-tests.mjs", "--test", ...archivos],
  { cwd: RAIZ, stdio: "inherit" }
);
process.exit(resultado.status ?? 1);
