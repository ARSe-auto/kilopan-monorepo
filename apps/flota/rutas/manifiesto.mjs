// Manifiesto de rutas de la plataforma FLOTA [AC-FTEN-26].
//
// QUÉ ES. El inventario de TODA ruta HTTP que la app sirve, con —por cada una— cómo se
// monta contra ella el cruce «sesión del tenant A con IDs de B» (§9.2, centinela 2 del
// §9.3). De acá salen dos cosas: la suite HTTP A-contra-B autogenerada (`e2e/cruce-tenant.
// spec.ts`) y las pruebas de AUSENCIA que otros módulos le piden al manifiesto — «no existe
// endpoint de línea manual» (AC-FTAR-04), «cero endpoint de emisión de DTE» (AC-FTAR-08),
// «nada de /cliente/* en el endpoint de captura» (07), impersonación (01).
//
// POR QUÉ SE DERIVA DEL ÁRBOL Y NO SE ESCRIBE A MANO (decisión de Alexis, 09-ago-2026).
// Una prueba de AUSENCIA solo prueba algo si el inventario no puede quedar incompleto. Con
// un manifiesto escrito a mano, «no hay endpoint de emisión de DTE en el manifiesto» es
// compatible con «alguien agregó uno y no lo declaró» — o sea, no prueba nada, y justo en
// el AC donde el costo de equivocarse es el art. 97 N°4 del Código Tributario. Derivado del
// árbol de `src/app/**`, que es de donde Next saca las rutas de verdad, esa ventana no
// existe: la ruta está en el manifiesto porque está en el disco.
//
// Y se COMITEA igual, aunque sea generado: así el diff del PR muestra la ruta nueva —que es
// donde un humano la ve— y el gate compara el archivo contra una regeneración. Difieren ⇒
// rojo. Lo generado es la LISTA; lo que se edita a mano es el `cruce` de cada entrada.
//
// ALCANCE DECLARADO, no supuesto: hoy `apps/flota` sirve dos rutas y todavía no existe la
// noción de sesión —nace en el módulo 01, hito (b)—. La identidad del tenant en un request
// es HOY su subdominio (AC-FTEN-05). Por eso conviven dos tipos de cruce: `sin_recurso`,
// para la ruta que no puede nombrar un recurso ajeno (el cruce que sí aplica es que la
// respuesta no traiga NADA de B), y `recurso`, para la que recibe un identificador (⇒ 404,
// jamás 403). El segundo tipo no tiene ninguna ruta que lo ejerza hasta el módulo 01: su
// emisor y su juicio se prueban contra fixtures en `manifiesto.test.mjs` y
// `veredicto.test.mjs`, no se dan por buenos sin ejercer.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/** Los siete verbos que Next reconoce como handler exportado de un `route.ts`. */
export const VERBOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Verbos que cambian estado: en ellos el AC exige además que la BD de B quede intacta. */
const VERBOS_MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Longitud mínima de una justificación de exención para contar como ESCRITA. Un «n/a» o
 *  un «por ahora» no es una justificación: es la exención sin justificar que el AC veta. */
export const LARGO_MINIMO_JUSTIFICACION = 40;

const ES_PAGINA = /^page\.(tsx|ts|jsx|js)$/;
const ES_HANDLER = /^route\.(ts|js)$/;

/**
 * `(grupo)` no es segmento de URL; `_privado` y `@slot` no son rutas.
 * Devuelve el segmento de URL, o null si el directorio no aporta ninguno, o `false` si el
 * subárbol entero no se sirve.
 */
function segmentoDeUrl(nombre) {
  if (nombre.startsWith("_") || nombre.startsWith("@")) return false;
  if (nombre.startsWith("(") && nombre.endsWith(")")) return null;
  return nombre;
}

/** `[id]` → `id` · `[...resto]` → `resto` · `[[...resto]]` → `resto`. */
function paramDeSegmento(segmento) {
  const m = /^\[+\.{0,3}([^\]]+)\]+$/.exec(segmento);
  return m ? m[1] : null;
}

/**
 * Verbos exportados por un `route.ts`. Las dos formas que Next acepta:
 * `export async function GET(…)` y `export const GET = …`.
 */
export function verbosDe(fuente) {
  const hallados = VERBOS.filter((v) => {
    const declaracion = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${v}\\b`, "m");
    const constante = new RegExp(`^export\\s+(?:const|let|var)\\s+${v}\\s*=`, "m");
    return declaracion.test(fuente) || constante.test(fuente);
  });
  return hallados;
}

/**
 * Recorre el árbol del App Router y devuelve las rutas que la app SIRVE, ordenadas.
 * Sin lista de exclusiones que haya que mantener: lo que no es `page` ni `route` no es ruta.
 */
export function inventariar(raizApp, raizDeLaApp = raizApp) {
  const rutas = [];

  const bajar = (dir, segmentos) => {
    const entradas = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );

    for (const e of entradas) {
      if (!e.isFile()) continue;
      const esPagina = ES_PAGINA.test(e.name);
      const esHandler = ES_HANDLER.test(e.name);
      if (!esPagina && !esHandler) continue;

      const ruta = "/" + segmentos.join("/");
      const archivo = relative(raizDeLaApp, join(dir, e.name)).split("\\").join("/");
      const metodos = esPagina ? ["GET"] : verbosDe(readFileSync(join(dir, e.name), "utf8"));
      // Un `route.ts` sin ningún verbo exportado no sirve nada: Next devuelve 405 en todo
      // método. Se INVENTARIA igual, con la lista vacía, para que la auditoría lo diga en
      // voz alta en vez de que la ruta desaparezca del manifiesto sin que nadie lo note.
      rutas.push({
        ruta: ruta === "/" ? "/" : ruta.replace(/\/$/, ""),
        archivo,
        metodos,
        params: segmentos.map(paramDeSegmento).filter((p) => p !== null),
      });
    }

    for (const e of entradas) {
      if (!e.isDirectory()) continue;
      const seg = segmentoDeUrl(e.name);
      if (seg === false) continue;
      bajar(join(dir, e.name), seg === null ? segmentos : [...segmentos, seg]);
    }
  };

  bajar(raizApp, []);
  return rutas.sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
}

/**
 * Une el inventario del disco con los metadatos declarados a mano en el manifiesto anterior.
 *
 * Preserva el `cruce` SOLO si la lista de métodos no cambió. Una ruta que ayer era `GET` y
 * hoy además acepta `POST` es una ruta cuyo cruce declarado quedó viejo —el AC pide, en las
 * mutaciones, que la BD de B quede sin cambios, y eso nadie lo declaró— así que vuelve a
 * quedar sin declarar y el gate la frena hasta que un humano la mire.
 */
export function componer(inventario, previo = null) {
  const declarado = new Map(
    (previo?.rutas ?? []).map((r) => [r.ruta, { cruce: r.cruce ?? null, metodos: r.metodos ?? [] }]),
  );

  return {
    "//": [
      "GENERADO por rutas/generar.mjs desde apps/flota/src/app/** [AC-FTEN-26].",
      "La LISTA de rutas no se edita a mano: se regenera con `node rutas/generar.mjs --escribir`",
      "y el gate la compara contra el árbol. Lo que SÍ se edita a mano es el `cruce` de cada",
      "entrada, que es cómo se monta contra ella el caso «sesión de A con IDs de B».",
    ].join(" "),
    rutas: inventario.map((r) => {
      const antes = declarado.get(r.ruta);
      const mismosMetodos =
        antes !== undefined &&
        antes.metodos.length === r.metodos.length &&
        antes.metodos.every((m, i) => m === r.metodos[i]);
      return { ...r, cruce: mismosMetodos ? antes.cruce : null };
    }),
  };
}

/** Texto canónico del manifiesto. Una sola forma posible, para que el diff signifique algo. */
export function serializar(manifiesto) {
  return JSON.stringify(manifiesto, null, 2) + "\n";
}

/** El encabezado bajo el cual vive el registro de exenciones. Ver `leerExenciones`. */
export const SECCION_EXENCIONES = "## Exenciones vigentes";

/**
 * Exenciones escritas. Formato, una por línea, y SOLO bajo el encabezado
 * `## Exenciones vigentes`:
 *
 *     - `/api/lo-que-sea` — justificación en prosa, de largo real.
 *
 * Se lee una sección y no el archivo entero por una razón concreta: el archivo DOCUMENTA su
 * propio formato, y un ejemplo escrito en el formato correcto es indistinguible de una
 * exención real. Con el archivo entero como registro, explicar cómo se exime una ruta
 * eximía una ruta — y encima una inexistente, que es el caso que el gate rebota.
 *
 * Mismo criterio que el linter de migraciones (AC-FTEN-06): se declaran en un archivo
 * versionado, se CUENTAN y se imprimen siempre. Una exención silenciosa es un agujero.
 */
export function leerExenciones(texto) {
  const corte = texto.indexOf(SECCION_EXENCIONES);
  if (corte === -1) return [];
  const exenciones = [];
  for (const linea of texto.slice(corte + SECCION_EXENCIONES.length).split("\n")) {
    if (linea.startsWith("## ")) break; // termina la sección: lo que sigue es otra cosa
    const m = /^-\s+`([^`]+)`\s+—\s*(.*)$/.exec(linea.trim());
    if (m) exenciones.push({ ruta: m[1], justificacion: m[2].trim() });
  }
  return exenciones;
}

/**
 * ¿Está el manifiesto en condiciones de generar la suite? Devuelve la lista de problemas;
 * vacía = sí. Cada problema es una frase que dice qué pasó y qué hacer.
 *
 * Los cuatro rebotes que pide el AC viven acá:
 *   · ruta sin cruce declarado ni exención escrita ⇒ problema (el caso no se puede emitir)
 *   · exención sin justificación escrita ⇒ problema
 *   · exención de una ruta que no existe ⇒ problema (exención muerta: tapa lo que ya no hay)
 *   · cruce mal declarado (tipo desconocido, o `recurso` sin de dónde sacar el ID de B)
 */
export function auditar(manifiesto, exenciones) {
  const problemas = [];
  const porRuta = new Map(manifiesto.rutas.map((r) => [r.ruta, r]));
  const exentas = new Map();

  for (const e of exenciones) {
    if (exentas.has(e.ruta)) problemas.push(`exención duplicada para «${e.ruta}»`);
    exentas.set(e.ruta, e);
    if (!porRuta.has(e.ruta)) {
      problemas.push(
        `exención de «${e.ruta}», que no es una ruta de la app: borrala de exenciones.md ` +
          `(una exención muerta tapa una ruta que ya no existe y hace de pantalla para la que sí)`,
      );
    }
    if (e.justificacion.length < LARGO_MINIMO_JUSTIFICACION) {
      problemas.push(
        `la exención de «${e.ruta}» no está justificada por escrito ` +
          `(${e.justificacion.length} caracteres; el mínimo es ${LARGO_MINIMO_JUSTIFICACION})`,
      );
    }
  }

  for (const r of manifiesto.rutas) {
    const exenta = exentas.has(r.ruta);
    if (r.metodos.length === 0) {
      problemas.push(`«${r.ruta}» (${r.archivo}) no exporta ningún verbo HTTP: no sirve nada`);
    }
    if (!r.cruce && !exenta) {
      problemas.push(
        `«${r.ruta}» no tiene caso de cruce ni exención escrita: declará su «cruce» en ` +
          `rutas/manifiesto.json, o su exención en rutas/exenciones.md`,
      );
      continue;
    }
    if (r.cruce && exenta) {
      problemas.push(
        `«${r.ruta}» está exenta Y tiene cruce declarado: una de las dos sobra ` +
          `(la exención gana en silencio y el caso declarado no se corre nunca)`,
      );
      continue;
    }
    if (!r.cruce) continue;

    if (r.cruce.tipo !== "sin_recurso" && r.cruce.tipo !== "recurso") {
      problemas.push(`«${r.ruta}» declara un cruce de tipo desconocido: «${r.cruce.tipo}»`);
      continue;
    }
    if (r.cruce.tipo === "recurso" && !r.cruce.ids_de_b?.tabla) {
      problemas.push(
        `«${r.ruta}» es de tipo «recurso» y no declara «ids_de_b»: sin decir de qué tabla ` +
          `de la BD de B sale el identificador, no hay recurso ajeno que pedir`,
      );
    }
    if (r.cruce.tipo === "sin_recurso" && r.params.length > 0) {
      problemas.push(
        `«${r.ruta}» tiene parámetros (${r.params.join(", ")}) y se declaró «sin_recurso»: ` +
          `una ruta que recibe un identificador SÍ puede nombrar un recurso de B`,
      );
    }
  }

  return problemas;
}

/**
 * Los casos que la suite debe emitir, uno por ruta y método. El emisor y el driver del e2e
 * están separados a propósito: así el emisor se prueba sin levantar un servidor.
 */
export function emitirCasos(manifiesto, exenciones) {
  const exentas = new Set(exenciones.map((e) => e.ruta));
  const casos = [];
  for (const r of manifiesto.rutas) {
    if (exentas.has(r.ruta) || !r.cruce) continue;
    for (const metodo of r.metodos) {
      casos.push({
        ruta: r.ruta,
        metodo,
        tipo: r.cruce.tipo,
        // La mutación la dicta el VERBO, no la declaración: un `POST` declarado como no
        // mutante seguiría escribiendo en la base. Lo que se declara es de dónde sale el
        // identificador de B; lo que muta es lo que HTTP dice que muta.
        muta: VERBOS_MUTANTES.has(metodo),
        ids_de_b: r.cruce.ids_de_b ?? null,
      });
    }
  }
  return casos;
}

/** Lee el manifiesto comiteado, o null si todavía no existe. */
export function leerManifiesto(ruta) {
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, "utf8"));
}
