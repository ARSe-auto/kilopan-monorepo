#!/usr/bin/env node
// gate-ganchos-e1.mjs — los ganchos del §4.9 en su estado EXACTO. [AC-FVEH-14]
//
// El §4.9 no dice «existen»: dice en qué ESTADO existe cada uno en E1, y el estado se puede
// perder de dos formas que ningún test de base atrapa.
//
//   1. DDL-ONLY significa CERO UI. `thermal_profile`, `alarm_rule`, `excursion` y `disposition`
//      tienen esquema y no tienen pantalla. La UI de cadena de frío es de E3 (§3-FUERA), y el
//      día que alguien agregue «una pantallita para ver las excursiones» habrá encendido en E1
//      un módulo que el maestro puso en E3 — sin tocar una sola migración, así que el pgTAP
//      seguiría en verde.
//
//   2. `ProveedorTelemetria` es una interfaz cuyas implementaciones REALES viven en un REGISTRO
//      POR DATOS (§4.9). En E1 admitía una sola —`declarada`—; la enmienda §11 (E1.5) sumó
//      `telefono_gps`, porque el teléfono del chofer ya trae GPS y no exige hardware
//      [AC-FTEL-06]. Lo que sigue FUERA es la telemetría de vehículo (§3-FUERA: nada de OBD,
//      OCPP ni API de fabricante): una de esas en el árbol es E4 entrando por la puerta de
//      atrás, y con ella se cae la matriz de honestidad del §7.7 —«prohibido prometer
//      compliance con datos declarados» solo se puede sostener si se sabe de dónde salen los
//      datos—. Por eso lo que se vigila es la lista de las PROHIBIDAS y no un conteo: el
//      registro puede crecer con implementaciones sin hardware sin aflojar nada.
//
// Lo que este gate NO hace: mirar la base. Que las tablas existan vacías y que el CHECK de
// honestidad rebote se prueba en `db/flota/pgtap/0005_ganchos_ddl_only.sql` (AC-FTEN-15); que
// `telefono_gps` esté sembrada, que activarla sea un UPDATE y que sumarla NO afloje la matriz de
// honestidad, en `db/flota/pgtap/0040_registro_de_telemetria.sql` (AC-FTEL-06).
//
// Uso: node db/flota/gate-ganchos-e1.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 un gancho salió de su estado.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const raizArg = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1];
const RAIZ = raizArg ?? RAIZ_REPO;

/** Las tablas que en E1 son DDL-only: esquema sí, pantalla no (§4.9). */
export const SIN_PANTALLA = ["thermal_profile", "alarm_rule", "excursion", "disposition"];

/**
 * Las implementaciones REALES del registro de `ProveedorTelemetria` (§4.9, §11) [AC-FTEL-06].
 *
 * Es el espejo en código de las filas que siembran las migraciones 0007 (`declarada`) y 0078
 * (`telefono_gps`): la BD es la autoridad sobre cuál está ACTIVA —eso es un UPDATE de la fila—
 * y esta lista solo dice cuáles tienen derecho a existir. Nombrarlas acá es lo que permite que
 * el mensaje del gate diga contra qué se está comparando.
 */
export const FUENTES_DEL_REGISTRO = ["declarada", "telefono_gps"];
/** Las que existen en el enum de `reading.fuente` y NO pueden tener implementación en E1. */
export const FUENTES_DE_E4 = ["archivo_logger", "api_fabricante", "sonda_vehiculo", "obd", "ocpp"];

// Las dos listas tienen que ser DISJUNTAS o el gate deja de significar algo: el día que alguien
// mueva una fuente al registro sin sacarla de las de E4, la misma cadena estaría permitida y
// prohibida a la vez, y cuál gana dependería del orden del bucle. [AC-FTEL-06]
for (const fuente of FUENTES_DEL_REGISTRO) {
  if (FUENTES_DE_E4.includes(fuente)) {
    throw new Error(
      `gate-ganchos-e1: «${fuente}» está en el registro Y en las fuentes de E4 a la vez — las ` +
        "dos listas tienen que ser disjuntas o la frontera entre E1.5 y E4 no separa nada",
    );
  }
}

/**
 * Los valores de `destinos.geo_confianza` que solo puede producir el GEOCODING, que es E2
 * (§3.E2) [AC-FRUT-15].
 *
 * El enum va completo en el DDL —es del §4.5 y agregarle un valor después es un ALTER TYPE en
 * producción— pero en E1 solo se producen `manual` y `sin_geo`: nadie geocodifica todavía. El
 * día que alguien escriba `rooftop` en el código, la app estará afirmando que una coordenada
 * cayó sobre el techo del local cuando en realidad la tecleó una persona — y de esa afirmación
 * cuelga que una parada se planifique sin que nadie confirme el pin.
 */
export const CONFIANZAS_DE_E2 = ["rooftop", "interpolado"];

/** Donde vive la UI. Es lo único que se mira para el punto 1: el DDL las nombra por oficio. */
const ARBOL_DE_UI = "apps/flota/src/app";
/** Donde podría aparecer una implementación de telemetría. */
const ARBOL_DE_CODIGO = ["apps/flota/src", "packages/nucleo-comun/src", "packages/miga/src"];

const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);
const esArtefacto = (n) => IGNORAR.has(n) || n.startsWith(".next");

function archivos(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      if (esArtefacto(entrada)) continue;
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.test(entrada)) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

/** Quita comentarios: nombrar un gancho para explicar por qué NO está es legítimo. */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

let fallo = false;
const problemas = [];
let revisadosUi = 0;
let revisadosCodigo = 0;

// --- 1. DDL-only = cero UI --------------------------------------------------------------
for (const ruta of archivos(join(RAIZ, ARBOL_DE_UI))) {
  revisadosUi++;
  const rel = relative(RAIZ, ruta);
  const codigo = sinComentarios(readFileSync(ruta, "utf8"));
  for (const tabla of SIN_PANTALLA) {
    // «Content-Disposition» es el header HTTP estándar para forzar la descarga de un archivo
    // (AC-FTEL-07, export de PODs): comparte la palabra «disposition» con la tabla DDL-only
    // del §4.9 por coincidencia del inglés — el header no lee ni escribe esa tabla, así que se
    // descarta esa ocurrencia antes de buscar en vez de aflojar el `\b${tabla}\b` para todos.
    const codigoRevisado =
      tabla === "disposition" ? codigo.replace(/content-disposition/gi, "") : codigo;
    if (new RegExp(String.raw`\b${tabla}\b`).test(codigoRevisado)) {
      problemas.push(
        `${rel} nombra «${tabla}» en el árbol de pantallas: en E1 ese gancho es DDL-only ` +
          "(§4.9) y su UI es de E3 (§3-FUERA)",
      );
      fallo = true;
    }
  }
}

// --- 2. ProveedorTelemetria con una sola implementación ---------------------------------
for (const arbol of ARBOL_DE_CODIGO) {
  for (const ruta of archivos(join(RAIZ, arbol))) {
    revisadosCodigo++;
    const rel = relative(RAIZ, ruta);
    if (rel === "db/flota/gate-ganchos-e1.mjs") continue;
    const codigo = sinComentarios(readFileSync(ruta, "utf8"));
    for (const confianza of CONFIANZAS_DE_E2) {
      // Mismo criterio que las fuentes: se busca la CADENA, porque escribir un
      // `geo_confianza` exige nombrarlo, y por ahí es por donde entra E2 sin querer.
      if (new RegExp(`['\"\`]${confianza}['\"\`]`).test(codigo)) {
        problemas.push(
          `${rel} usa la confianza de geocoding «${confianza}»: en E1 solo se producen ` +
            "«manual» y «sin_geo», el geocoding es E2 (§3.E2, §4.5)",
        );
        fallo = true;
      }
    }
    for (const fuente of FUENTES_DE_E4) {
      // Se busca la fuente como CADENA: una implementación de telemetría real tiene que
      // nombrar su fuente para escribir en `reading.fuente`, y por ahí es por donde entra.
      //
      // Pero `archivo_logger` vive en DOS enums distintos: es una fuente de `reading` (E4,
      // prohibida) y también un tipo de `evidencia` (§4.6, DDL desde el día 1 y legítimo). Un
      // MIEMBRO DE UNIÓN de TypeScript —la línea que empieza con `|`— es lo segundo, y morderlo
      // marcaba como telemetría de E4 la lista de tipos de evidencia que el POD necesita
      // escribir. Pasó el 11-ago-2026 y frenó al motor con el AC ya terminado.
      const lineasVivas = codigo
        .split("\n")
        .filter((l) => !/^\s*\|\s*['"`][a-z_]+['"`]\s*,?\s*$/.test(l))
        .join("\n");
      if (new RegExp(String.raw`['"\`]${fuente}['"\`]`).test(lineasVivas)) {
        problemas.push(
          `${rel} usa la fuente «${fuente}»: no está en el registro de ProveedorTelemetria ` +
            `(«${FUENTES_DEL_REGISTRO.join("», «")}», §4.9, §11, §3-FUERA)`,
        );
        fallo = true;
      }
    }
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
console.log(
  `gate-ganchos-e1: ${SIN_PANTALLA.length} ganchos DDL-only × ${revisadosUi} archivos de UI · ` +
    `${FUENTES_DE_E4.length} fuentes de E4 y ${CONFIANZAS_DE_E2.length} confianzas de E2 × ` +
    `${revisadosCodigo} archivos de código · ` +
    `${problemas.length} problemas`,
);
if (revisadosUi === 0) {
  // Verde vacuo declarado: sin árbol de pantallas este gate no probó nada.
  console.log("gate-ganchos-e1: SIN ÁRBOL DE PANTALLAS — no se verificó ninguna UI");
}
if (fallo) {
  console.error("gate-ganchos-e1: ROJO");
  process.exit(1);
}
console.log("gate-ganchos-e1: VERDE");
