#!/usr/bin/env node
// gate-consentimiento.mjs — el grep del §7.8 [AC-FIDN-20]:
// «la UI de enrolamiento NO presenta consentimiento a trabajadores».
//
// POR QUÉ ESTO NO ES UNA FORMALIDAD. La base de licitud del tratamiento de los datos de un
// trabajador es la EJECUCIÓN DEL CONTRATO, no su consentimiento. Ponerle un checkbox a alguien
// que necesita el teléfono para trabajar sería fingir una opción que no tiene — y bajo la Ley
// 21.719 un consentimiento que no se puede negar sin costo no es consentimiento: es un vicio
// que además DEBILITA la posición del tenant, porque invita a discutir si el tratamiento tenía
// base legal. El checkbox no sobra: hace daño.
//
// EL ALCANCE SE DERIVA, NO SE ESCRIBE. Una lista de pantallas escrita a mano se queda corta el
// día que alguien agrega la cuarta, y ese día el AC deja de estar probado sin que nada se ponga
// rojo. Acá el flujo de enrolamiento son LAS PANTALLAS QUE LLAMAN A LOS ENDPOINTS DE
// ENROLAMIENTO: una pantalla que postea a `/api/solicitudes` o a `/api/reenrolamiento` ES el
// flujo, lo llame como lo llame quien la escribió.
//
// LO QUE ESTE GATE NO PROHÍBE, y es la razón de que tenga alcance en vez de barrer todo: los
// TÉRMINOS DEL TENANT y el DPA del §3.E1.15 sí existen y sí se aceptan — pero los acepta el
// ADMIN en el wizard de alta (AC-FMIG-22, hito g), que es una persona jurídica contratando un
// servicio y no un trabajador entregando su RUT para poder trabajar. Un gate que barriera la
// app entera chocaría con ese AC y alguien lo apagaría.
//
// Uso: node db/flota/gate-consentimiento.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 hay consentimiento en una pantalla de enrolamiento.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ =
  process.argv.find((a) => a.startsWith("--raiz="))?.slice("--raiz=".length) ??
  new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

const ARBOL = "apps/flota/src/app";

/** Los endpoints por los que se entra al tenant. Quien los llama es el flujo de enrolamiento. */
export const ENDPOINTS_DE_ENROLAMIENTO = ["/api/solicitudes", "/api/reenrolamiento"];

/** Cuántas pantallas tiene que haber, como mínimo, para que el verde signifique algo. F-B
 *  («Solicitar acceso») y F-E («Ya tengo cuenta») del §5.4. Con cero pantallas encontradas
 *  este gate pasaría sin haber leído una sola línea, que es el falso verde más barato. */
export const PANTALLAS_MINIMAS = 2;

/**
 * Lo que NO puede aparecer. Dos familias, y la segunda importa tanto como la primera: un
 * checkbox es evidente en una revisión, pero un párrafo que dice «al continuar aceptás…» hace
 * exactamente lo mismo sin control que marcar — y pasa desapercibido.
 */
export const PROHIBIDOS = [
  { nombre: "checkbox", patron: /type\s*=\s*["'{]?\s*["']?checkbox["']?/i },
  { nombre: "checkbox por rol ARIA", patron: /role\s*=\s*["']checkbox["']/i },
  { nombre: "la palabra consentimiento", patron: /consentimient|consiento|consentir/i },
  { nombre: "aceptación de términos", patron: /\bacepto\b|\bacept[aá]s\b|t[eé]rminos y condiciones/i },
  { nombre: "autorización de tratamiento", patron: /autorizo\b|autoriz[aá]s\b|tratamiento de (?:mis )?datos/i },
  { nombre: "política de privacidad", patron: /pol[ií]tica de privacidad/i },
];

function paginas(dir, salida = []) {
  if (!existsSync(dir)) return salida;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const ruta = join(dir, e.name);
    if (statSync(ruta).isDirectory()) paginas(ruta, salida);
    else if (/^page\.(tsx|jsx|ts|js)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/**
 * Revisa UN archivo. Exportada para que sus mutantes la ejerzan sin tocar el disco del repo.
 * Devuelve `{ esDelFlujo, problemas }`: una pantalla que no llama a los endpoints no es del
 * flujo y no se juzga acá.
 */
export function revisarArchivo(rel, contenido) {
  const esDelFlujo = ENDPOINTS_DE_ENROLAMIENTO.some((e) => contenido.includes(e));
  if (!esDelFlujo) return { esDelFlujo, problemas: [] };

  const problemas = [];
  const lineas = contenido.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    // Un comentario que EXPLICA por qué no hay consentimiento no es consentimiento. Sin esto,
    // documentar la regla sería lo que pone el gate en rojo — y un gate que castiga su propia
    // explicación es un gate que alguien borra junto con el comentario.
    if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(linea)) continue;
    for (const { nombre, patron } of PROHIBIDOS) {
      if (!patron.test(linea)) continue;
      problemas.push({
        archivo: rel,
        linea: i + 1,
        motivo:
          `${nombre} en una pantalla del enrolamiento. La base de licitud es la ejecución del ` +
          "contrato (§7.8), no el consentimiento del trabajador: pedírselo finge una opción que " +
          "no tiene y debilita la posición del tenant bajo la Ley 21.719.",
        texto: linea.trim().slice(0, 110),
      });
    }
  }
  return { esDelFlujo, problemas };
}

function principal() {
  const archivos = paginas(join(RAIZ, ARBOL));
  const delFlujo = [];
  const problemas = [];

  for (const ruta of archivos) {
    const rel = relative(RAIZ, ruta);
    const veredicto = revisarArchivo(rel, readFileSync(ruta, "utf8"));
    if (!veredicto.esDelFlujo) continue;
    delFlujo.push(rel);
    problemas.push(...veredicto.problemas);
  }

  for (const p of problemas) console.error(`GATE: ${p.archivo}:${p.linea} ${p.motivo}\n        ${p.texto}`);

  console.log(
    `gate-consentimiento: ${delFlujo.length} pantalla(s) del enrolamiento en ${ARBOL} ` +
      `(derivadas de ${ENDPOINTS_DE_ENROLAMIENTO.join(", ")}) · ${problemas.length} hallazgo(s)`,
  );
  console.log(`gate-consentimiento: alcance → ${delFlujo.join(", ") || "(ninguna)"}`);

  if (delFlujo.length < PANTALLAS_MINIMAS) {
    console.error(
      `GATE: solo ${delFlujo.length} pantalla(s) del enrolamiento; se esperan al menos ` +
        `${PANTALLAS_MINIMAS} (F-B «Solicitar acceso» y F-E «Ya tengo cuenta», §5.4). ` +
        "Un gate que no encuentra qué revisar pasa en verde sin haber revisado nada.",
    );
    process.exit(1);
  }
  if (problemas.length > 0) {
    console.error("gate-consentimiento: ROJO");
    process.exit(1);
  }
  console.log("gate-consentimiento: VERDE");
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
