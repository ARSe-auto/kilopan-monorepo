#!/usr/bin/env node
// gate-criterios-kiloruta.mjs — guardián mecánico de la lista CONGELADA de criterios
// KiloRuta [AC-FTEN-18] y, más adelante, de la matriz mecánica [AC-FTEN-19].
//
// El oráculo de AC-FTEN-18 es HUMANO: la lista la aprueba Alexis, y ningún script puede
// sustituir esa firma. Lo que este gate sí puede —y debe— hacer es impedir que la lista
// APROBADA se deforme después sin que nadie lo note: el encabezado «HECHO VERIFICADO» del
// maestro exige IDs cerrados `KR-01…KR-NN` con N explícito, y una lista que se renumera
// sola deja de demostrar compatibilidad con nada.
//
// Verifica:
//   1. `docs/criterios-kiloruta.txt` existe.
//   2. Declara `N = <n>` exactamente una vez.
//   3. Hay exactamente n criterios, con la forma `KR-NN [clase] …`.
//   4. Los IDs son contiguos KR-01…KR-<n>, cada uno exactamente una vez (ni hueco ni
//      repetido: un ID reciclado cambiaría de significado en silencio).
//   5. Toda clase pertenece al conjunto cerrado.
//   6. La firma del dueño está presente — sin ella la lista no está congelada, está en
//      borrador, y el hito (a) no debía continuar.
//
// Uso: node db/flota/gate-criterios-kiloruta.mjs [--lista=<ruta>]
// Exit: 0 verde · 1 lista rota.
//
// `--lista` existe solo para que el propio guardián sea testeable contra listas mutadas
// (gate-criterios-kiloruta.test.mjs): un guardián sin prueba de que se pone rojo es teatro.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../..", import.meta.url).pathname;
const LISTA =
  process.argv.slice(2).find((a) => a.startsWith("--lista="))?.split("=")[1] ??
  join(RAIZ, "docs/criterios-kiloruta.txt");

const CLASES = new Set(["cubierto", "parcial", "supersedido", "bloqueado", "omision"]);
const FIRMA = /^Aprobada por Alexis el (\d{2}-[a-z]{3}-\d{4})\.$/m;

let fallo = false;
const err = (msg) => {
  console.error(`GATE: ${msg}`);
  fallo = true;
};

if (!existsSync(LISTA)) {
  err("falta docs/criterios-kiloruta.txt — la lista congelada es el primer ítem del hito (a)");
  console.error("gate-criterios-kiloruta: ROJO");
  process.exit(1);
}

const texto = readFileSync(LISTA, "utf8");

// 2. N declarada, una sola vez.
const declaraciones = [...texto.matchAll(/^N = (\d+)$/gm)].map((m) => Number(m[1]));
if (declaraciones.length !== 1) {
  err(`la lista declara ${declaraciones.length} veces su N (debe declararla exactamente una vez, como 'N = 63')`);
}
const n = declaraciones[0];

// 3-5. Los criterios.
const criterios = [...texto.matchAll(/^KR-(\d{2}) \[([a-z]+)\]/gm)];
if (n !== undefined && criterios.length !== n) {
  err(`la lista declara N = ${n} pero trae ${criterios.length} criterios`);
}

const vistos = new Map();
for (const [linea, num, clase] of criterios.map((m) => [m[0], Number(m[1]), m[2]])) {
  if (vistos.has(num)) err(`KR-${String(num).padStart(2, "0")} aparece más de una vez`);
  vistos.set(num, clase);
  if (!CLASES.has(clase)) {
    err(`${linea.trim()}: clase '${clase}' fuera del conjunto cerrado (${[...CLASES].join(", ")})`);
  }
}
if (n !== undefined) {
  for (let i = 1; i <= n; i++) {
    if (!vistos.has(i)) err(`falta KR-${String(i).padStart(2, "0")}: los IDs deben ser contiguos KR-01…KR-${n}`);
  }
}

// 6. La firma del dueño (oráculo humano de AC-FTEN-18).
const firma = texto.match(FIRMA);
if (!firma) {
  err("la lista no lleva la firma del dueño ('Aprobada por Alexis el DD-mmm-AAAA.') — sin firma no está congelada");
}

if (fallo) {
  console.error("gate-criterios-kiloruta: ROJO");
  process.exit(1);
}
const porClase = [...vistos.values()].reduce((a, c) => ((a[c] = (a[c] ?? 0) + 1), a), {});
console.log(
  `gate-criterios-kiloruta: ${n} criterios congelados (${Object.entries(porClase)
    .sort()
    .map(([c, k]) => `${k} ${c}`)
    .join(" · ")}) — firmada el ${firma[1]}`
);
console.log("gate-criterios-kiloruta: VERDE");
