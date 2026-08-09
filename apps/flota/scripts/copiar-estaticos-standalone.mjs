#!/usr/bin/env node
// `next build` con output:"standalone" arma un server.js autocontenido con sus propias
// node_modules — pero NO copia .next/static/ ni public/ adentro. Es un paso manual
// documentado por Next.js que es fácil de olvidar, y el síntoma es brutal: el server
// standalone responde 200 en todas las rutas (SSR completo), así que un healthcheck
// como el de railway.json ("GET /ingresar") pasa perfecto — pero cada request a
// /_next/static/*.js da 404, la app nunca hidrata, y NINGÚN botón de NINGUNA pantalla
// hace nada. Se ve bien en una captura y está completamente muerta al tocarla.
//
// Encontrado corriendo el build standalone real contra un navegador (no solo `curl`,
// que no puede detectar esto): ver docs/OPERACION_5G_Y_POSTGRES.md.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
// Mismo distDir que next.config.ts lee de NEXT_DIST_DIR (ej. .next-e2e para el build
// propio del e2e, separado del .next de producción — ver playwright.config.ts).
const DIST_DIR = process.env.NEXT_DIST_DIR || ".next";
// outputFileTracingRoot (next.config.ts) apunta a la raíz del monorepo, así que el
// standalone reproduce la ruta completa: <distDir>/standalone/apps/flota/.
const DESTINO = join(APP_DIR, DIST_DIR, "standalone", "apps", "flota");

if (!existsSync(DESTINO)) {
  console.error(`copiar-estaticos-standalone: no existe ${DESTINO} — ¿corriste "next build" con output:"standalone"?`);
  process.exit(1);
}

mkdirSync(join(DESTINO, DIST_DIR), { recursive: true });
cpSync(join(APP_DIR, DIST_DIR, "static"), join(DESTINO, DIST_DIR, "static"), { recursive: true });
cpSync(join(APP_DIR, "public"), join(DESTINO, "public"), { recursive: true });

console.log("copiar-estaticos-standalone: OK (.next/static y public/ copiados al standalone)");
