#!/usr/bin/env node
// gate-fixtures-exclusivos.mjs — un RUT declarado «propio y no prestado» lo usa UNA sola suite.
//
// ─── EL BUG QUE LO TRAE (12-ago-2026) ─────────────────────────────────────────────
//
// Tres suites reclamaban el índice 20 de la lista congelada para su PERSONA. Dos compartían
// tenant, así que la segunda en correr moría en su `beforeAll` con
// `duplicate key ... personas_tenant_id_rut_key`, y de ahí en más ninguna de sus aserciones
// significaba nada. El rojo que se veía era «cola-offline no encontrado» — a tres pasos de
// la causa, en un archivo que no tenía ningún problema.
//
// Y no falla siempre: mientras las suites que chocan corran contra tenants distintos, no
// pasa nada. Es una bomba con temporizador — el día que dos de ellas compartan tenant,
// vuelve el mismo rojo ilegible.
//
// ─── POR QUÉ ESTA REGLA Y NO «NINGÚN ÍNDICE REPETIDO» ─────────────────────────────
//
// Porque compartir está BIEN casi siempre. El índice 1 lo usan catorce suites y ninguna
// choca; el 6 es la empresa contratante y se comparte A PROPÓSITO, con `on conflict` en su
// insert. Un gate que prohibiera todo repetido saldría rojo sobre catorce archivos sanos y
// lo apagarían el primer día.
//
// Lo que se vigila es lo que la propia lista DECLARA. `db/flota/ruts-sinteticos.mjs`
// documenta cada RUT con su razón, y los que existen para no compartirse lo dicen con esas
// palabras: «propio y no prestado», porque el índice de un dispositivo personal ACTIVO por
// operario (§4.3) impide que dos suites que comparten persona tengan cada una su aparato
// enrolado. Este gate no inventa una regla nueva: hace cumplir la que ya está escrita.
//
// El día que un RUT deje de necesitar exclusividad, se le saca esa frase a su razón — y el
// gate deja de exigírsela. La declaración y la comprobación viven en el mismo lugar.
//
// Uso:  node packages/metodo/scripts/gate-fixtures-exclusivos.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 un RUT exclusivo lo reclaman dos suites.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? process.cwd();

/** La marca que un RUT usa para declararse exclusivo de una suite. */
export const MARCA_EXCLUSIVO = "propio y no prestado";

/** Los índices de la lista congelada cuya razón se declara exclusiva. */
export function indicesExclusivos(textoLista) {
  const salida = [];
  // Las claves del objeto VALIDOS, en orden: el índice ES la posición, que es como lo piden
  // las suites (`rutDeFixture(n)`).
  const bloque = textoLista.split("export const VALIDOS = {")[1] ?? "";
  const fin = bloque.indexOf("\n};");
  const cuerpo = fin === -1 ? bloque : bloque.slice(0, fin);
  let i = 0;
  for (const linea of cuerpo.split("\n")) {
    // Una entrada es `"<rut>": "<razón>",`. Los comentarios y las líneas en blanco no cuentan.
    if (!/^\s*"[^"]+"\s*:/.test(linea)) continue;
    if (linea.includes(MARCA_EXCLUSIVO)) salida.push(i);
    i++;
  }
  return salida;
}

/** Qué suites reclaman cada índice: {indice: [archivo, …]}. */
export function reclamosDe(dirE2e) {
  const porIndice = {};
  if (!existsSync(dirE2e)) return porIndice;
  for (const archivo of readdirSync(dirE2e).sort()) {
    if (!archivo.endsWith(".spec.ts")) continue;
    const texto = readFileSync(join(dirE2e, archivo), "utf8");
    const vistos = new Set();
    // Las dos formas de pedir un RUT de la lista: la nueva, con guardia, y la vieja por índice.
    for (const m of texto.matchAll(/rutDeFixture\((\d+)\)|VALIDOS\)\[(\d+)\]/g)) {
      vistos.add(Number(m[1] ?? m[2]));
    }
    for (const n of vistos) (porIndice[n] ??= []).push(archivo);
  }
  return porIndice;
}

/** Los índices exclusivos que más de una suite reclama. */
export function choques(raiz) {
  const lista = join(raiz, "db/flota/ruts-sinteticos.mjs");
  if (!existsSync(lista)) return { revisados: 0, fallos: [] };
  const exclusivos = indicesExclusivos(readFileSync(lista, "utf8"));
  const reclamos = reclamosDe(join(raiz, "apps/flota/e2e"));
  const fallos = [];
  for (const i of exclusivos) {
    const suites = reclamos[i] ?? [];
    if (suites.length > 1) fallos.push({ indice: i, suites });
  }
  return { revisados: exclusivos.length, fallos };
}

if (process.argv[1] && process.argv[1].endsWith("gate-fixtures-exclusivos.mjs")) {
  const { revisados, fallos } = choques(RAIZ);
  for (const f of fallos) {
    console.error(
      `GATE: el RUT del índice ${f.indice} se declara «${MARCA_EXCLUSIVO}» y lo reclaman ` +
        `${f.suites.length} suites: ${f.suites.join(", ")}. La segunda en correr contra el ` +
        `mismo tenant muere en su beforeAll con duplicate key sobre personas, y el rojo ` +
        `aparece a tres pasos de acá. Dale su propio RUT: agregalo AL FINAL de VALIDOS en ` +
        `db/flota/ruts-sinteticos.mjs —nunca en el medio, que corre los índices de las demás—.`,
    );
  }
  console.log(`gate-fixtures-exclusivos: ${revisados} RUTs declarados exclusivos · ${fallos.length} reclamados dos veces`);
  if (revisados === 0) {
    // Verde vacuo declarado: sin RUTs exclusivos que vigilar, este gate no probó nada.
    console.log("gate-fixtures-exclusivos: NINGÚN RUT SE DECLARA EXCLUSIVO — no se verificó nada");
  }
  if (fallos.length > 0) { console.error("gate-fixtures-exclusivos: ROJO"); process.exit(1); }
  console.log("gate-fixtures-exclusivos: VERDE");
}
