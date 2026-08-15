// LA APP JAMÁS EMITE DTE — guardrail como código [AC-FTAR-08]. Spec 06 §7.3, §4.6, §3.E2.
//
// QUÉ VIGILA. Dos cosas, y la violación de cualquiera aborta el ítem:
//
//   1. Que en `apps/flota/src` no aparezca ninguna firma de ESTRUCTURA de documento tributario
//      —el tag `<DTE`, el `<TED`, el `<CAF`, la firma XML-DSIG, un generador de folios—. La
//      lista vive en `firmas-de-estructura.json`, versionada y legible: es el mismo estándar
//      del grep explícito del §7.1.
//   2. Que el manifiesto de rutas (AC-FTEN-26) no declare NINGÚN endpoint de emisión.
//
// POR QUÉ ES UN GATE Y NO UNA CONVENCIÓN. Emitir un documento con apariencia de DTE sin ser
// emisor autorizado por el SII es el art. 97 N°4 del Código Tributario: no es una multa, es un
// delito. La app REGISTRA folios que emitió un tercero autorizado (`reference_document`) y eso
// es todo lo que hace hoy y lo que hará en E1. La emisión real llega en E2, por el puerto
// `EmisorDTE` contra un proveedor autorizado, y cuando llegue esta lista se edita a mano y con
// nombre y apellido — que es exactamente la fricción que se busca.
//
// POR QUÉ LAS FIRMAS SON DE ESTRUCTURA Y NUNCA LA PALABRA «DTE». El registro manual usa «DTE»,
// «folio», «emisor» y «TED» en su código y en sus comentarios, legítimamente y todo el tiempo.
// Un gate que muerda esas palabras se vuelve ruido, y un gate ruidoso termina desactivado — que
// es la única forma real de perder esta protección.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = import.meta.dirname;
const APP = join(AQUI, "..");

/** La lista versionada, tal cual está en el repo. */
export const LISTA = JSON.parse(readFileSync(join(AQUI, "firmas-de-estructura.json"), "utf8"));

/** Las firmas con su expresión regular ya compilada. Sin bandera `g`: `exec` sin estado. */
export function firmasCompiladas(lista = LISTA) {
  return lista.firmas.map((f) => {
    if (f.banderas.includes("g")) throw new Error(`${f.id}: la bandera 'g' haría que exec lleve estado`);
    return { ...f, regex: new RegExp(f.patron, f.banderas) };
  });
}

/** Extensiones que se leen. El resto de `src/` (imágenes, fuentes) no puede contener un DTE. */
const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".sql", ".xml"];

/** Todo archivo de texto bajo `dir`, recursivo, saltando lo generado y lo instalado. */
export function archivosDe(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entrada.name === "node_modules" || entrada.name === ".next") continue;
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosDe(ruta));
    else if (EXTENSIONES.some((e) => entrada.name.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

/**
 * Las firmas que aparecen en UN texto. Se reporta línea por línea porque un hallazgo acá lo va
 * a leer alguien que tiene que decidir en un minuto si borra código o edita la lista.
 */
export function escanearTexto(ruta, contenido, lista = firmasCompiladas()) {
  const hallazgos = [];
  const lineas = contenido.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    for (const f of lista) {
      if (f.regex.test(lineas[i])) {
        hallazgos.push({ archivo: ruta, linea: i + 1, firma: f.id, porque: f.porque, texto: lineas[i].trim().slice(0, 140) });
      }
    }
  }
  return hallazgos;
}

/** El árbol entero. Por omisión, `apps/flota/src` — el alcance que fija el AC. */
export function escanearArbol(dir = join(APP, "src"), lista = firmasCompiladas()) {
  const hallazgos = [];
  for (const ruta of archivosDe(dir)) {
    hallazgos.push(...escanearTexto(relative(APP, ruta), readFileSync(ruta, "utf8"), lista));
  }
  return hallazgos;
}

/**
 * Rutas del manifiesto que serían un endpoint de EMISIÓN. Dos reglas: el segmento exacto
 * (`/api/dte/...`) y el verbo en cualquier parte del camino (`/api/liquidaciones/[id]/emitir-33`),
 * porque quien agregue la puerta no la va a llamar como la lista espera.
 */
export function revisarManifiesto(manifiesto, lista = LISTA) {
  const prohibidos = new Set(lista.segmentos_de_emision_prohibidos.map((s) => s.toLowerCase()));
  const sospechosas = [];
  for (const r of manifiesto.rutas) {
    const ruta = r.ruta.toLowerCase();
    const segmento = ruta.split("/").filter(Boolean).find((s) => prohibidos.has(s));
    const verbo = lista.verbos_de_emision_en_la_ruta.find((v) => ruta.includes(v));
    if (segmento) sospechosas.push({ ruta: r.ruta, motivo: `segmento de emisión «${segmento}»` });
    else if (verbo) sospechosas.push({ ruta: r.ruta, motivo: `verbo de emisión «${verbo}» en la ruta` });
  }
  return sospechosas;
}

/** El gate completo. Devuelve el informe; no imprime ni sale — eso es del CLI. */
export function correr() {
  const enElArbol = escanearArbol();
  const manifiesto = JSON.parse(readFileSync(join(APP, "rutas", "manifiesto.json"), "utf8"));
  return { enElArbol, enElManifiesto: revisarManifiesto(manifiesto), rutasRevisadas: manifiesto.rutas.length };
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { enElArbol, enElManifiesto, rutasRevisadas } = correr();
  for (const h of enElArbol) {
    console.error(`✗ ${h.archivo}:${h.linea} — firma «${h.firma}»: ${h.porque}\n    ${h.texto}`);
  }
  for (const s of enElManifiesto) {
    console.error(`✗ manifiesto de rutas: ${s.ruta} — ${s.motivo}`);
  }
  if (enElArbol.length || enElManifiesto.length) {
    console.error(
      "\nLa app JAMÁS emite DTE (art. 97 N°4 CT, §7.3). Si esto es registro manual de un folio " +
        "emitido FUERA de la app, reescríbelo sin la firma de estructura; si de verdad hace falta " +
        "emitir, es E2 y va por el puerto EmisorDTE, no por acá.",
    );
    process.exit(1);
  }
  console.log(
    `✓ [AC-FTAR-08] ${LISTA.firmas.length} firmas de estructura de DTE, cero en apps/flota/src; ` +
      `${rutasRevisadas} rutas del manifiesto, cero endpoint de emisión.`,
  );
}
