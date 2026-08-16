#!/usr/bin/env node
// gate-logs.mjs — el scan de logs del §9.2 [AC-FIDN-06]:
// «cero PIN en cualquier forma, cero RUT sin máscara, cero secreto de dispositivo en logs».
//
// POR QUÉ ES ESTÁTICO Y NO SOBRE LA SALIDA. Un scan del texto que los tests imprimieron solo
// ve las ramas que los tests recorrieron, y la línea que filtra un PIN es casi siempre la del
// `catch` que nadie ejerció. Mirando el CÓDIGO se ven todas, incluidas las que todavía no
// corrió nadie. La contra —que no ve un log armado dinámicamente— se acota con la regla de
// abajo: lo que se vigila son los IDENTIFICADORES que llevan el dato, no el dato.
//
// POR QUÉ EL HASH DEL PIN CUENTA COMO PIN. El PIN del §0 es cortísimo: su espacio entero se
// recorre en un rato de cómputo. Un `pin_hash` en un log es el PIN a un rato de cómputo de distancia,
// así que «en cualquier forma» lo incluye, y este gate también.
//
// Uso: node db/flota/gate-logs.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 un log que puede llevarse un dato que no puede salir.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ =
  process.argv.find((a) => a.startsWith("--raiz="))?.slice("--raiz=".length) ??
  new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/** Los árboles que sirven la aplicación. Lo que no se sirve no escribe en su log. */
const ALCANCE = ["apps/flota/src", "apps/flota/servidor.mjs"];
const EXTENSIONES = /\.(ts|tsx|mjs|js)$/;
/** Los tests imprimen a propósito y no son la aplicación. */
const EXCLUIR = /\.test\.(ts|tsx|mjs)$/;

/** Las formas de escribir en un log que hoy existen en este árbol. */
const LLAMADA_DE_LOG = /\b(?:console\.(?:log|info|warn|error|debug|trace)|process\.std(?:out|err)\.write)\s*\(/;

/**
 * Lo que no puede viajar en un log, por identificador y con frontera de palabra.
 *
 * La frontera NO es un detalle: `ruteo` contiene «rut» y `servidor.mjs` tiene un
 * `console.error("ruteo: fallo resolviendo el host", …)` perfectamente sano. Un gate que lo
 * marcara sería un gate que alguien apaga en la primera semana, y un gate apagado no protege
 * nada.
 */
const PROHIBIDOS = [
  { nombre: "PIN", patron: /\bpin\b|\bpin_hash\b|\bpinNuevo\b/i },
  { nombre: "RUT", patron: /\brut\b|\brut_propuesto\b|\brutPropuesto\b/i },
  { nombre: "secreto de dispositivo", patron: /\bsecreto\b|\bsecreto_hash\b|\bsecretoHash\b/i },
  { nombre: "clave privada o pública del enrolamiento", patron: /\bclave_privada\b|\bclavePrivada\b/i },
];

/** La única forma en que un RUT puede aparecer en un log (§7.8). */
const CON_MASCARA = /\benmascararRut\s*\(/;

function archivos(dir, acumulado = []) {
  if (!existsSync(dir)) return acumulado;
  if (statSync(dir).isFile()) return EXTENSIONES.test(dir) ? [...acumulado, dir] : acumulado;
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      archivos(ruta, acumulado);
    } else if (EXTENSIONES.test(entrada.name) && !EXCLUIR.test(entrada.name)) {
      acumulado.push(ruta);
    }
  }
  return acumulado;
}

/**
 * Revisa UN archivo. Exportada para que sus mutantes la ejerzan sin tocar el disco del repo.
 * Devuelve la lista de problemas: `{ archivo, linea, texto, motivo }`.
 */
export function revisarArchivo(rutaRelativa, contenido) {
  const problemas = [];
  const lineas = contenido.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    // Un comentario que NOMBRA la regla no es una violación de la regla. Sin esto, explicar
    // por qué el PIN no va al log sería lo que pone el gate en rojo.
    if (/^\s*(\/\/|\*|\/\*|--)/.test(linea)) continue;
    if (!LLAMADA_DE_LOG.test(linea)) continue;
    for (const { nombre, patron } of PROHIBIDOS) {
      if (!patron.test(linea)) continue;
      if (nombre === "RUT" && CON_MASCARA.test(linea)) continue;
      problemas.push({
        archivo: rutaRelativa,
        linea: i + 1,
        texto: linea.trim(),
        motivo:
          nombre === "RUT"
            ? "RUT sin máscara en un log — pasalo por enmascararRut() de packages/nucleo-comun (§7.8)"
            : `${nombre} en un log — no sale de la aplicación en ninguna forma (§4.3, §7.8)`,
      });
    }
  }
  return problemas;
}

function principal() {
  const revisados = ALCANCE.flatMap((d) => archivos(join(RAIZ, d)));
  const problemas = revisados.flatMap((ruta) =>
    revisarArchivo(relative(RAIZ, ruta), readFileSync(ruta, "utf8")),
  );

  for (const p of problemas) {
    console.error(`GATE: ${p.archivo}:${p.linea} ${p.motivo}\n        ${p.texto}`);
  }
  // Se imprime SIEMPRE qué se miró: un gate que solo habla cuando encuentra algo es un gate
  // del que nadie sabe si corrió (§10, «no silent caps»).
  console.log(
    `gate-logs: ${PROHIBIDOS.length} reglas × ${revisados.length} archivos en ${ALCANCE.join(", ")} · ` +
      `${problemas.length} problemas`,
  );
  if (problemas.length > 0) {
    console.error("gate-logs: ROJO");
    return 1;
  }
  console.log("gate-logs: VERDE");
  return 0;
}

if (process.argv[1]?.endsWith("gate-logs.mjs")) process.exit(principal());
