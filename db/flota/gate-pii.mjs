#!/usr/bin/env node
// gate-pii.mjs — 21.719 ESTRUCTURAL [AC-FIDN-14]: ninguna tabla de hechos lleva datos que
// identifiquen a una persona (§7.8, §4.3, §3.E1.15).
//
// LA REGLA DE FONDO. Los identificadores viven en `personas` y los hechos la referencian por
// su ID opaco. Eso es lo que hace posible la supresión de la Ley 21.719: se anonimiza UNA
// fila y el ledger append-only —que no se puede tocar (§7.4) y que además no se debe, porque
// es prueba de entregas— queda intacto. Un RUT copiado dentro de `eventos` rompe las dos
// mitades a la vez: la supresión deja de ser posible y el ledger pasa a ser un archivo de
// datos personales.
//
// Se mecaniza sobre las MIGRACIONES y no sobre el cluster para que corra en el gate rápido,
// sin base de datos: el momento de atrapar una columna así es cuando se escribe, no diez
// minutos después.
//
// Uso: node db/flota/gate-pii.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 una columna identificante fuera de donde puede estar.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ =
  process.argv.find((a) => a.startsWith("--raiz="))?.slice("--raiz=".length) ??
  new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = join(RAIZ, "db/migraciones-flota");

/**
 * Columnas que identifican a una persona SIN ambigüedad. Ninguna otra cosa se llama así.
 * `nombre` NO está acá: se trata aparte, más abajo, y por una razón.
 */
export const MARCADORES = [
  /^rut(_|$)/,
  /^contacto(_|$)/,
  /^telefono(_|$)/,
  /^fono(_|$)/,
  /^email(_|$)/,
  /^correo(_|$)/,
  /^direccion(_|$)/,
  /^apellido/,
];

/**
 * Las únicas tablas del plano del tenant donde un identificador puede estar.
 *
 * DESVIACIÓN DECLARADA respecto del texto del AC, que dice «personas y empresas_cliente»:
 * `solicitudes_acceso` entra como tercera. Guarda el RUT y el nombre de la persona PROPUESTA
 * —todavía no es persona del tenant— y tiene que guardarlos: el §4.3 hace que la identidad se
 * cree recién al aprobar (AC-FIDN-04), justamente para que cualquiera con un link no pueda
 * sembrar filas en `personas`. O el dato espera ahí, o hay que crear la persona al solicitar,
 * que es peor. Es plano de IDENTIDAD, no de hechos, y la anonimización la alcanza igual
 * porque una solicitud resuelta se purga por `retention_policy` (AC-FIDN-01).
 */
export const TABLAS_DE_IDENTIDAD = new Set(["personas", "empresas_cliente", "solicitudes_acceso"]);

/**
 * `nombre` es la palabra más reusada del esquema: la tienen los grupos, los tipos de carga y
 * los planes, y ninguno es una persona. Prohibirla en todas partes obligaría a declarar una
 * exención por cada catálogo, y una regla con doce exenciones es una regla que nadie lee.
 *
 * Se juzga por la CLASE que la tabla ya declara en su `COMMENT ON TABLE` (§4.2, exigido por
 * AC-FTEN-06): en una tabla CAPTURA —un hecho del terreno— un `nombre` es el de una persona,
 * y ahí sí es rojo. La clase no es una lista nueva que mantener: es la que el otro linter ya
 * obliga a escribir.
 */
const ES_NOMBRE = /^nombre(_|$)/;

function archivosSql(dir, salida = []) {
  if (!existsSync(dir)) return salida;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivosSql(ruta, salida);
    else if (e.name.endsWith(".sql")) salida.push(ruta);
  }
  return salida.sort();
}

const sinComentarios = (sql) => sql.replace(/--[^\n]*/g, "");

/** El cuerpo entre paréntesis balanceados que arranca en `desde`. */
function cuerpoBalanceado(texto, desde) {
  const abre = texto.indexOf("(", desde);
  if (abre === -1) return null;
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return texto.slice(abre + 1, i);
  }
  return null;
}

/** Nombre de columna de cada línea de una definición de tabla, salteando las restricciones. */
function columnasDe(cuerpo) {
  const columnas = [];
  let nivel = 0;
  let actual = "";
  for (const c of cuerpo) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      columnas.push(actual);
      actual = "";
    } else actual += c;
  }
  columnas.push(actual);
  return columnas
    .map((c) => c.trim().split(/\s+/)[0]?.toLowerCase() ?? "")
    .filter((c) => c && !/^(primary|unique|foreign|constraint|check|exclude|like)$/.test(c));
}

/**
 * Revisa el SQL de UN archivo. Exportada para que sus mutantes la ejerzan sin tocar el repo.
 * `crudo` incluye los comentarios, porque las exenciones se declaran ahí.
 */
export function revisarSql(rel, crudo) {
  const problemas = [];
  const exenciones = [];
  const sql = sinComentarios(crudo);

  // El plano de CONTROL es de la plataforma, no de un tenant: sus filas son los clientes de
  // KiloRuta, no las personas de la operación, y el §7.8 rige sobre estas últimas. Se dice en
  // voz alta en vez de mirar para otro lado.
  if (/(^|[\\/])control[\\/]/.test(rel)) return { problemas, exenciones, plano: "control" };

  for (const m of crudo.matchAll(/^--\s*pii:\s*exenta\s+([a-z_][a-z0-9_.]*)\s*—\s*(.+)$/gim)) {
    exenciones.push({ archivo: rel, columna: m[1], razon: m[2].trim() });
  }
  const exentas = new Set(exenciones.map((e) => e.columna));

  /** La clase declarada de una tabla, o null si no la declara en este archivo. */
  const claseDe = (tabla) => {
    const m = new RegExp(
      String.raw`comment\s+on\s+table\s+${tabla}\s+is\s+'\s*([A-ZÁÉÍÓÚÑ]+)`,
      "i",
    ).exec(sql);
    return m ? m[1].toUpperCase() : null;
  };

  const revisar = (tabla, columnas) => {
    const clase = claseDe(tabla);
    for (const columna of columnas) {
      if (exentas.has(`${tabla}.${columna}`)) continue;

      if (MARCADORES.some((p) => p.test(columna)) && !TABLAS_DE_IDENTIDAD.has(tabla)) {
        problemas.push({
          archivo: rel,
          donde: `${tabla}.${columna}`,
          motivo:
            "identificador de persona fuera del plano de identidad — los hechos referencian el " +
            "ID opaco de `personas` (§7.8). Si de verdad hace falta acá, declaralo con " +
            `\`-- pii: exenta ${tabla}.${columna} — <razón>\` y quedará contado.`,
        });
      }

      if (ES_NOMBRE.test(columna) && clase === "CAPTURA") {
        problemas.push({
          archivo: rel,
          donde: `${tabla}.${columna}`,
          motivo:
            "un `nombre` en una tabla CAPTURA es el nombre de una persona dentro del ledger, " +
            "que es append-only y no se puede anonimizar (§7.4, §7.8)",
        });
      }
    }
  };

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
    const cuerpo = cuerpoBalanceado(sql, m.index + m[0].length);
    if (cuerpo) revisar(m[1].toLowerCase(), columnasDe(cuerpo));
  }

  // Una columna agregada después es tan columna como una del CREATE: sin esto, la vía para
  // meter un RUT en `eventos` sería escribir la migración siguiente.
  for (const m of sql.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
  )) {
    const tabla = m[1].toLowerCase();
    const columnas = [...m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map(
      (c) => c[1].toLowerCase(),
    );
    if (columnas.length > 0) revisar(tabla, columnas);
  }

  return { problemas, exenciones, plano: "tenant" };
}

function principal() {
  const archivos = archivosSql(DIR);
  const problemas = [];
  const exenciones = [];
  for (const ruta of archivos) {
    const r = revisarSql(relative(RAIZ, ruta), readFileSync(ruta, "utf8"));
    problemas.push(...r.problemas);
    exenciones.push(...r.exenciones);
  }

  for (const p of problemas) console.error(`GATE: ${p.archivo} — ${p.donde}: ${p.motivo}`);
  for (const e of exenciones) console.log(`  exención de PII declarada: ${e.columna} — ${e.razon}`);
  console.log(
    `gate-pii: ${archivos.length} migraciones · ${TABLAS_DE_IDENTIDAD.size} tablas de identidad · ` +
      `${exenciones.length} exenciones · ${problemas.length} problemas`,
  );
  if (archivos.length === 0) {
    console.error("gate-pii: no hay migraciones que revisar — un verde acá no diría nada");
    return 1;
  }
  if (problemas.length > 0) {
    console.error("gate-pii: ROJO");
    return 1;
  }
  console.log("gate-pii: VERDE");
  return 0;
}

if (process.argv[1]?.endsWith("gate-pii.mjs")) process.exit(principal());
