#!/usr/bin/env node
// gate-lock-al-dia.mjs — ningún package.json aterriza sin su entrada en el lock.
//
// ─── EL BUG QUE LO TRAE (12-ago-2026) ─────────────────────────────────────────────
//
// El commit ea5b9b1 agregó `"@axe-core/playwright": "^4.12.1"` a apps/flota/package.json y
// dejó `pnpm-lock.yaml` FUERA del commit. En la máquina no se notó: el install local no es
// `--frozen-lockfile` y el lock correcto estaba en el árbol, sin comitear. En GitHub sí:
// el workflow corre `pnpm install --frozen-lockfile` ANTES de cualquier prueba, así que el
// run muere ahí, sin ejecutar un solo test, y manda su correo de «run failed».
//
// Ese es el peor lugar donde puede aparecer un defecto: invisible acá, fatal allá, y con el
// aviso llegándole a una persona en vez de a un gate.
//
// ─── POR QUÉ NO INVOCA A pnpm ─────────────────────────────────────────────────────
//
// Correr `pnpm install --frozen-lockfile` sería la comprobación más fiel, pero cuesta
// segundos, toca la red y puede escribir. Un gate que tarda es un gate que alguien saltea.
// Acá alcanza con comparar dos textos que ya están en el árbol: lo que cada package.json
// PIDE y lo que el bloque `importers:` del lock DICE que resolvió. Si el lock no conoce una
// dependencia, o la conoce con otro rango, `--frozen-lockfile` va a fallar — que es lo
// único que este gate promete.
//
// No comprueba integridad de versiones ni el árbol resuelto: eso es trabajo de pnpm y de
// `audit`. Prometer más de lo que mira sería peor que no existir.
//
// Uso:  node packages/metodo/scripts/gate-lock-al-dia.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 el lock no conoce algo que un package.json pide.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? process.cwd();

/** Los paquetes del workspace, por su ruta relativa — que es la llave que usa `importers:`. */
export function paquetesDe(raiz) {
  const rutas = [];
  if (existsSync(join(raiz, "package.json"))) rutas.push(".");
  for (const grupo of ["apps", "packages"]) {
    const dir = join(raiz, grupo);
    if (!existsSync(dir)) continue;
    for (const nombre of readdirSync(dir).sort()) {
      if (existsSync(join(dir, nombre, "package.json"))) rutas.push(`${grupo}/${nombre}`);
    }
  }
  return rutas;
}

/** Lo que un package.json PIDE: {nombre: rango}, juntando dependencies y devDependencies. */
export function pedidasDe(textoJson) {
  const p = JSON.parse(textoJson);
  return { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
}

/**
 * Lo que el lock DICE que resolvió para un importer: {nombre: specifier}.
 *
 * Se lee por indentación en vez de con un parser de YAML a propósito: agregar una
 * dependencia al gate no puede exigir agregar una dependencia al repo. El formato de
 * `importers:` es estable y plano —dos niveles de sangría y un `specifier:` por paquete—,
 * así que un lector de líneas alcanza y no se rompe con lo que cambie más abajo.
 */
export function resueltasDe(textoLock, importer) {
  const lineas = textoLock.split("\n");
  const iImporters = lineas.findIndex((l) => l === "importers:");
  if (iImporters === -1) return null;
  const cabecera = `  ${importer}:`;
  let i = lineas.indexOf(cabecera, iImporters);
  if (i === -1) return null;

  const salida = {};
  let paquete = null;
  for (i += 1; i < lineas.length; i++) {
    const l = lineas[i];
    if (l.trim() === "") continue;
    // Otro importer (2 espacios) o el fin del bloque (0 espacios) ⇒ terminamos.
    const sangria = l.length - l.trimStart().length;
    if (sangria <= 2 && l.trim().endsWith(":") && l !== cabecera) break;
    if (sangria === 0) break;
    const mPaquete = l.match(/^      '?([^':]+)'?:\s*$/);
    if (mPaquete) { paquete = mPaquete[1]; continue; }
    const mSpec = l.match(/^\s+specifier:\s*(.+?)\s*$/);
    if (mSpec && paquete) salida[paquete] = mSpec[1].replace(/^['"]|['"]$/g, "");
  }
  return salida;
}

/** Los desajustes entre lo que se pide y lo que el lock conoce. */
export function desajustes(raiz) {
  const lock = join(raiz, "pnpm-lock.yaml");
  if (!existsSync(lock)) return [{ problema: "no hay pnpm-lock.yaml en la raíz" }];
  const textoLock = readFileSync(lock, "utf8");
  const fallos = [];
  for (const importer of paquetesDe(raiz)) {
    const pj = importer === "." ? join(raiz, "package.json") : join(raiz, importer, "package.json");
    const pedidas = pedidasDe(readFileSync(pj, "utf8"));
    if (Object.keys(pedidas).length === 0) continue;
    const resueltas = resueltasDe(textoLock, importer);
    if (resueltas === null) {
      fallos.push({ importer, problema: "el lock no tiene un bloque para este paquete" });
      continue;
    }
    for (const [nombre, rango] of Object.entries(pedidas)) {
      if (!(nombre in resueltas)) {
        fallos.push({ importer, nombre, problema: `el lock no conoce '${nombre}' (pide ${rango})` });
      } else if (resueltas[nombre] !== rango) {
        fallos.push({
          importer, nombre,
          problema: `el lock resolvió '${nombre}' para ${resueltas[nombre]} y el package.json pide ${rango}`,
        });
      }
    }
  }
  return fallos;
}

// Como módulo (lo importa su suite) no ejecuta nada; como guion, es el gate.
if (process.argv[1] && process.argv[1].endsWith("gate-lock-al-dia.mjs")) {
  const fallos = desajustes(RAIZ);
  const paquetes = paquetesDe(RAIZ);
  for (const f of fallos) {
    console.error(`GATE: ${f.importer ?? ""} — ${f.problema}`);
  }
  console.log(`gate-lock-al-dia: ${paquetes.length} paquetes del workspace · ${fallos.length} desajustes`);
  if (paquetes.length === 0) {
    // Verde vacuo declarado: sin paquetes que mirar, este gate no probó nada.
    console.log("gate-lock-al-dia: SIN PAQUETES — no se verificó ninguno");
  }
  if (fallos.length > 0) {
    console.error(
      "gate-lock-al-dia: ROJO — 'pnpm install --frozen-lockfile' (lo que corre CI antes de " +
        "cualquier prueba) va a fallar acá. Correr 'pnpm install' y comitear pnpm-lock.yaml " +
        "JUNTO al package.json que lo pide.",
    );
    process.exit(1);
  }
  console.log("gate-lock-al-dia: VERDE");
}
