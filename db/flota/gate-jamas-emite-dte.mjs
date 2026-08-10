#!/usr/bin/env node
// gate-jamas-emite-dte.mjs — la app REFERENCIA documentos, jamás los emite. [AC-FRUT-08]
//
// El §7.3 lo pide con esas palabras y no es una preferencia de arquitectura: emitir un documento
// con apariencia de DTE sin ser emisor autorizado por el SII es el art. 97 N°4 del Código
// Tributario. No es una multa — es un delito, y lo comete quien firma la empresa.
//
// ─── POR QUÉ ESTO TIENE QUE SER UN GATE Y NO UNA REGLA ESCRITA ────────────────────
//
// Porque la línea que la rompa se va a escribir con la mejor intención. El camino es siempre el
// mismo: un cliente pide «que la app le mande la guía al destinatario», alguien arma un PDF con
// el folio y el timbre, y en ese momento la app pasó de referenciar a producir algo que se ve
// como un DTE. Nadie lo va a llamar «emitir». Va a decir «armamos el comprobante».
//
// Por eso el gate no busca la palabra «emitir»: busca las CAPACIDADES que hacen falta para
// producir uno —generar folios, armar el XML del SII, construir o firmar el TED— y la firma
// digital sobre documentos tributarios. Ninguna de esas tiene un uso legítimo en E1.
//
// ─── LO QUE SÍ ESTÁ PERMITIDO, Y POR ESO NO SE PERSIGUE ──────────────────────────
//
// LEER el TED de un papel y tomar de ahí tipo, folio y emisor. Eso es capturar, y es exactamente
// lo que el andén hace. La diferencia entre leer y producir es la que este gate cuida: `escanear`,
// `leer` y `folio` como DATO están bien; `generarFolio`, `firmarXml` o `construirTed`, no.
//
// Uso: node db/flota/gate-jamas-emite-dte.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 apareció una capacidad de emisión.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/**
 * Las capacidades que producen un DTE. Se persigue el VERBO junto al objeto, no el objeto solo:
 * `folio` es un dato legítimo que el andén teclea, y `generarFolio` es la capacidad prohibida.
 *
 * Cada patrón lleva por qué existe, porque el día que uno se ponga rojo lo primero que va a
 * pensar quien lo lea es que el gate se equivocó.
 */
export const CAPACIDADES = [
  {
    nombre: "generación de folios",
    patron: /\b(generar|crear|asignar|emitir|obtener|siguiente|next)[_A-Za-z]*[Ff]olio/,
    porque:
      "el folio lo asigna el SII al emisor autorizado. Generarlo acá es producir el número de " +
      "un documento tributario que esta empresa no puede emitir",
  },
  {
    nombre: "construcción del TED",
    patron: /\b(generar|crear|construir|armar|firmar|build|make)[_A-Za-z]*[Tt]ed\b/,
    porque:
      "el TED es el timbre electrónico del documento. Construirlo es fabricar la prueba " +
      "criptográfica de un DTE, que es el corazón del art. 97 N°4",
  },
  {
    nombre: "XML de documento tributario",
    // La etiqueta XML se busca DENTRO de una cadena: `Promise<Documento[]>` es un genérico de
    // TypeScript y morderlo enseñaría a apagar el gate el primer día.
    patron: /\b(generar|crear|construir|armar|firmar)[_A-Za-z]*(Dte|DTE)\b|['"`][^'"`]*<(Documento|DTE|TED)[\s>]/,
    porque:
      "el XML del SII ES el documento. Armarlo, aunque no se envíe, deja en el árbol la máquina " +
      "de emitir — y lo que existe termina usándose",
  },
  {
    nombre: "firma digital de documentos tributarios",
    patron: /\b(firmarDte|firmar_dte|firmaElectronica|certificadoDigital|caf\b|CAF\b)/,
    porque:
      "el CAF es el archivo con el que el SII autoriza a emitir un rango de folios. Que aparezca " +
      "en el árbol solo tiene una lectura",
  },
];

/** Dónde puede aparecer: todo el código que la app despacha. */
export const ARBOLES = ["apps/flota/src", "packages/nucleo-comun/src", "packages/miga/src"];

const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);

function archivos(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (IGNORAR.has(entrada) || entrada.startsWith(".next")) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

/**
 * Quita comentarios.
 *
 * Explicar POR QUÉ la app no emite es obligatorio —lo hacen la migración 0042 y el servidor de
 * manifiestos— y un gate que muerda al documentar enseña a dejar de documentar.
 */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Las capacidades de emisión que aparecen en este texto, con su línea 1-indexada. */
export function emisionesEn(texto) {
  const vivo = sinComentarios(texto);
  const hallazgos = [];
  vivo.split("\n").forEach((linea, i) => {
    for (const capacidad of CAPACIDADES) {
      if (capacidad.patron.test(linea)) hallazgos.push({ linea: i + 1, capacidad });
    }
  });
  return hallazgos;
}

let fallo = false;
const problemas = [];
let revisados = 0;

for (const arbol of ARBOLES) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    revisados++;
    const rel = relative(RAIZ, ruta);
    if (rel === "db/flota/gate-jamas-emite-dte.mjs") continue;
    for (const { linea, capacidad } of emisionesEn(readFileSync(ruta, "utf8"))) {
      problemas.push(
        `${rel}:${linea} trae ${capacidad.nombre}: la app REFERENCIA documentos de terceros y ` +
          `JAMÁS los emite (§7.3, art. 97 N°4 CT) — ${capacidad.porque}`,
      );
      fallo = true;
    }
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-jamas-emite-dte: ${CAPACIDADES.length} capacidades × ${revisados} archivos · ` +
    `${problemas.length} problemas`,
);
if (revisados === 0) {
  // Verde vacuo declarado: sin árbol que mirar, este gate no probó nada.
  console.log("gate-jamas-emite-dte: SIN ÁRBOL DE CÓDIGO — no se verificó ningún archivo");
}
if (fallo) {
  console.error("gate-jamas-emite-dte: ROJO");
  process.exit(1);
}
console.log("gate-jamas-emite-dte: VERDE");
