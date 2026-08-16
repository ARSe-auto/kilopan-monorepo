#!/usr/bin/env node
// gate-matriz-kiloruta.mjs — el consumo mecánico de la lista congelada [AC-FTEN-19].
// §9.1(4)(a), AC-FTEN-18 (la lista) → AC-FTEN-19 (esta matriz).
//
// LAS TRES VERIFICACIONES QUE EL AC PIDE, y ninguna es decorativa:
//
//   1. `count(filas) == N`. La N sale de `docs/criterios-kiloruta.txt`, no de un número escrito
//      acá: dos copias de la misma cifra se separan, y la que se queda vieja es siempre la que
//      nadie mira. Si mañana se emite KR-64 con firma del dueño, esta matriz se pone roja hasta
//      que la fila exista — que es exactamente lo que tiene que pasar.
//   2. Cada ID aparece EXACTAMENTE una vez, y los IDs son contiguos KR-01…KR-N. Un duplicado
//      esconde a un faltante: la cuenta da bien y un criterio quedó sin mapear.
//   3. Cada test REFERENCIADO existe: el archivo está y el fragmento del nombre aparece en él.
//      Un criterio que apunta a un test borrado o renombrado es peor que uno sin mapear, porque
//      se lee como cubierto.
//
// LAS FILAS SIN TEST SE CUENTAN Y SE IMPRIMEN SIEMPRE. Los 63 criterios cubren los ocho
// módulos y hoy están construidos dos; una fila cuyo AC no existe todavía no puede referenciar
// un test que no existe. Lleva un marcador declarado y el gate lo NOMBRA en cada corrida —
// mismo criterio que las exenciones de rutas de AC-FTEN-26: una pendencia silenciosa es una
// pendencia que nadie vuelve a mirar.
//
// Y EXIGE AL MENOS UN TEST REAL: con todas las filas pendientes, la verificación 3 pasaría sin
// haber comprobado nada. Es el verde vacuo que este arnés existe para matar.
//
// Uso: node db/flota/gate-matriz-kiloruta.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 la matriz no cierra contra la lista congelada o un test no existe.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ =
  process.argv.find((a) => a.startsWith("--raiz="))?.slice("--raiz=".length) ??
  new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export const LISTA = "docs/criterios-kiloruta.txt";
export const MATRIZ = "docs/matriz-kiloruta.md";

/** `N = 63` en la lista congelada. Es la única fuente de la cuenta. */
export function leerN(textoLista) {
  const m = /^\s*N\s*=\s*(\d+)\s*$/m.exec(textoLista);
  return m ? Number(m[1]) : null;
}

/** Las filas de la tabla MD: `| KR-NN | tabla | test |`. El encabezado y el separador no son filas. */
export function leerFilas(textoMatriz) {
  const filas = [];
  for (const linea of textoMatriz.split("\n")) {
    const m = /^\|\s*(KR-\d+)\s*\|([^|]*)\|(.*)\|\s*$/.exec(linea.trim());
    if (!m) continue;
    filas.push({ id: m[1], tabla: m[2].trim(), test: m[3].trim() });
  }
  return filas;
}

/** `ruta::fragmento` → las dos partes, o null si la celda no referencia un test. */
export function referenciaDe(celda) {
  const corte = celda.indexOf("::");
  if (corte === -1) return null;
  const ruta = celda.slice(0, corte).trim();
  const fragmento = celda.slice(corte + 2).trim();
  if (!ruta || !fragmento) return null;
  return { ruta, fragmento };
}

/**
 * Juzga la matriz contra la lista. Exportada para que sus mutantes la ejerzan sin tocar el
 * disco: `existeTest(ruta, fragmento)` se inyecta para poder probar el caso «el test no está»
 * sin borrar un archivo del repo.
 */
export function auditar({ textoLista, textoMatriz, existeTest }) {
  const problemas = [];
  const n = leerN(textoLista);
  if (n === null) {
    return { problemas: [`${LISTA} no declara su N: sin ella la matriz no se puede contar`], filas: [], n: null, conTest: 0, pendientes: [] };
  }

  const filas = leerFilas(textoMatriz);
  if (filas.length !== n) {
    problemas.push(
      `la matriz tiene ${filas.length} filas y la lista congelada declara N = ${n}: ` +
        "cada criterio se mapea o la compatibilidad con KiloRuta queda afirmada sin respaldo",
    );
  }

  const vistos = new Map();
  for (const f of filas) vistos.set(f.id, (vistos.get(f.id) ?? 0) + 1);
  for (const [id, veces] of vistos) {
    if (veces > 1) problemas.push(`${id} aparece ${veces} veces: un duplicado esconde a un faltante`);
  }
  for (let i = 1; i <= n; i++) {
    const id = `KR-${String(i).padStart(2, "0")}`;
    if (!vistos.has(id)) problemas.push(`falta ${id}: los IDs son contiguos KR-01…KR-${n}`);
  }
  for (const id of vistos.keys()) {
    const numero = Number(id.slice(3));
    if (!Number.isInteger(numero) || numero < 1 || numero > n) {
      problemas.push(`${id} no pertenece al rango KR-01…KR-${n} de la lista congelada`);
    }
  }

  const pendientes = [];
  let conTest = 0;
  for (const f of filas) {
    const ref = referenciaDe(f.test);
    if (!ref) {
      pendientes.push(f.id);
      // Una celda sin test tiene que DECIR por qué. Un guion suelto se lee igual que un olvido.
      if (!/\((pendiente|bloqueado|supersedido|descartado|diferido):/.test(f.test)) {
        problemas.push(
          `${f.id} no referencia un test y no declara por qué: escribí ` +
            "«— (pendiente: AC-XXX · hito y)» o la clase que corresponda",
        );
      }
      continue;
    }
    conTest++;
    if (!existeTest(ref.ruta, ref.fragmento)) {
      problemas.push(
        `${f.id} referencia «${ref.ruta}::${ref.fragmento}», que no existe en el repo: ` +
          "un criterio que apunta a un test borrado o renombrado se lee como cubierto",
      );
    }
  }

  if (conTest === 0) {
    problemas.push(
      "ninguna fila referencia un test: la verificación de existencia pasaría sin haber " +
        "comprobado nada (verde vacuo prohibido)",
    );
  }

  return { problemas, filas, n, conTest, pendientes };
}

function principal() {
  const rutaLista = join(RAIZ, LISTA);
  const rutaMatriz = join(RAIZ, MATRIZ);
  for (const r of [rutaLista, rutaMatriz]) {
    if (!existsSync(r)) {
      console.error(`GATE: falta ${r} — la matriz de AC-FTEN-19 se apoya en los dos archivos`);
      process.exit(1);
    }
  }

  const veredicto = auditar({
    textoLista: readFileSync(rutaLista, "utf8"),
    textoMatriz: readFileSync(rutaMatriz, "utf8"),
    existeTest: (ruta, fragmento) => {
      const completa = join(RAIZ, ruta);
      if (!existsSync(completa)) return false;
      return readFileSync(completa, "utf8").includes(fragmento);
    },
  });

  for (const p of veredicto.problemas) console.error(`GATE: ${p}`);
  console.log(
    `gate-matriz-kiloruta: ${veredicto.filas.length}/${veredicto.n ?? "?"} criterios mapeados · ` +
      `${veredicto.conTest} con test verificado · ${veredicto.pendientes.length} sin test todavía`,
  );
  console.log(
    `gate-matriz-kiloruta: sin test → ${veredicto.pendientes.join(", ") || "(ninguno)"}`,
  );

  if (veredicto.problemas.length > 0) {
    console.error("gate-matriz-kiloruta: ROJO");
    process.exit(1);
  }
  console.log("gate-matriz-kiloruta: VERDE");
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
