#!/usr/bin/env node
// gate-terreno-sin-parametros.mjs — el terreno lee la VISTA, no la tabla de parámetros.
// [AC-FTAR-17]
//
// La otra mitad del AC ya está en la base: la 0073 le puso `aplicar_rls_de_dinero()` a las
// cuatro tablas de economía pura y resolvió `parametros` con la vista `parametros_operativos`,
// y el pgTAP 0037 afirma que esa vista existe, que no trae las dos columnas de plata y que sí
// trae la configuración. Lo que NINGUNA de esas dos cosas puede afirmar es esta: que el código
// que corre para el chofer efectivamente lea la vista.
//
// POR QUÉ LA BASE NO PUEDE DEFENDERLO SOLA. `parametros` no lleva —ni puede llevar— la RLS de
// dinero del §4.8: esconde filas enteras, y ahí el dinero convive en la MISMA fila con
// `reserva_pct`, `factor_consumo` y `bultos_max_sin_receptor`, que son con lo que el terreno
// opera. Apagarle el dinero al chofer le apagaría el trabajo (la fórmula de energía del §0). Un
// `revoke select` por columna tampoco: el rol de Postgres es UNO por tenant (`app_t_<slug>`,
// §4.1) y el papel del usuario viaja en `app.current_role`, una variable de SESIÓN que un GRANT
// no mira — le quitaría la columna al gestor igual que al chofer. La consecuencia es incómoda y
// hay que decirla: la tabla queda legible, y lo único que separa al terreno del dinero es de
// qué relación pregunta. Eso es exactamente lo que un gate estático sí puede vigilar y una
// prueba de base no.
//
// EL DEFECTO QUE PREVIENE. Alguien agrega a la pantalla del chofer un dato de configuración,
// escribe `from parametros` porque es el nombre obvio, y el `select` de al lado —o el `to_jsonb`
// de un snapshot— se lleva `tarifa_kwh_clp` al teléfono del repartidor. No rebota nada, no falla
// ningún test, y la regla del §4.8 queda rota sin que se vea. La vista no es preferencia de
// estilo: es dónde termina el alcance de la consulta.
//
// CÓMO DECIDE. En `apps/flota/src` (el código de aplicación), toda lectura de la relación
// `parametros` —`from parametros` o `join parametros`— tiene que ser de `parametros_operativos`,
// salvo los archivos DECLARADOS abajo con su motivo. La lista es una aserción EXACTA en las dos
// direcciones: un archivo nuevo que lea la tabla se pone rojo, y un declarado que dejó de
// leerla también — para que la excepción no sobreviva a su motivo.
//
// Uso: node db/flota/gate-terreno-sin-parametros.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 el terreno lee la tabla, la lista de excepciones quedó desactualizada, o
//       nadie lee la vista (verde vacuo).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { sinComentarios } from "./gate-dinero-en-la-bd.mjs";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const RAIZ = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1] ?? RAIZ_REPO;

/** El árbol de código de aplicación que se revisa. */
export const ARBOL = "apps/flota/src";

/** La vista que el terreno consume: la configuración de `parametros` sin las columnas de plata. */
export const VISTA = "parametros_operativos";

const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORAR = new Set(["node_modules", "dist", "build", ".git"]);
const esArtefacto = (nombre) => IGNORAR.has(nombre) || nombre.startsWith(".next");

/**
 * Quiénes leen la TABLA a propósito, y por qué. Exacta: ni de más ni de menos.
 *
 * Hoy hay uno solo. El tablero «Listos para salir» es del OPERADOR —su ruta lo dice en la
 * primera línea (§5.2-F1 lo pone en la web del operador)— y no es una pantalla de terreno, así
 * que la regla del §4.8 no lo alcanza. Si mañana deja de leer la tabla, esta entrada se cae
 * sola y el gate lo dice: una excepción que sobrevive a su motivo es cómo vuelve el defecto.
 */
export const LEEN_LA_TABLA_A_PROPOSITO = new Map([
  [
    "apps/flota/src/servidor/tablero.ts",
    "tablero «Listos para salir» (§5.2-F1) — es del OPERADOR, no del terreno, y solo proyecta " +
      "`factor_consumo` y `reserva_pct`: ninguna columna de plata sale de esa consulta",
  ],
]);

/**
 * ¿Esta línea lee la relación `parametros` a secas?
 *
 * `parametros_operativos` NO cuenta, y no hace falta excluirlo a mano: `\b` no cierra antes de
 * un `_`, que es carácter de palabra. Se miran las dos formas en que una relación entra a una
 * consulta —`from` y `join`—, porque el tablero la trae por `left join` y un gate que solo
 * mirara el `from` la dejaría pasar.
 */
export function leeLaTabla(linea) {
  return /\b(?:from|join)\s+parametros\b/i.test(linea);
}

/** ¿Esta línea lee la vista? Es el antídoto al verde vacuo: alguien tiene que estar leyéndola. */
export function leeLaVista(linea) {
  return new RegExp(String.raw`\b(?:from|join)\s+${VISTA}\b`, "i").test(linea);
}

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

/**
 * Revisa un árbol. Devuelve los hallazgos (lecturas de la tabla NO declaradas), las
 * declaraciones que ya nadie usa, y si alguien lee la vista. Exportada para los mutantes.
 */
export function revisar(raiz = RAIZ, arbol = ARBOL, declarados = LEEN_LA_TABLA_A_PROPOSITO) {
  const hallazgos = [];
  const declaradosVistos = new Set();
  let revisados = 0;
  let hayLectorDeLaVista = false;

  for (const ruta of archivos(join(raiz, arbol))) {
    const rel = relative(raiz, ruta);
    revisados++;
    sinComentarios(readFileSync(ruta, "utf8"))
      .split("\n")
      .forEach((linea, i) => {
        if (leeLaVista(linea)) hayLectorDeLaVista = true;
        if (!leeLaTabla(linea)) return;
        if (declarados.has(rel)) declaradosVistos.add(rel);
        else hallazgos.push({ rel, linea: i + 1 });
      });
  }

  const declaracionesMuertas = [...declarados.keys()].filter((r) => !declaradosVistos.has(r));
  return { hallazgos, declaracionesMuertas, hayLectorDeLaVista, revisados };
}

// --- CLI -------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let fallo = false;
  const { hallazgos, declaracionesMuertas, hayLectorDeLaVista, revisados } = revisar();

  for (const h of hallazgos) {
    console.error(
      `GATE: ${h.rel}:${h.linea} lee la TABLA \`parametros\` — el terreno lee \`${VISTA}\`, ` +
        "que no trae `tarifa_kwh_clp` ni `precio_diesel_litro_clp` (§4.8, migración 0073). " +
        "Si esta lectura es del operador y no del terreno, decláralo en LEEN_LA_TABLA_A_PROPOSITO",
    );
    fallo = true;
  }

  for (const rel of declaracionesMuertas) {
    console.error(
      `GATE: ${rel} está declarado como lector de la tabla \`parametros\` y ya no la lee — ` +
        "sacá la entrada de LEEN_LA_TABLA_A_PROPOSITO: una excepción que sobrevive a su motivo " +
        "es por dónde vuelve el defecto",
    );
    fallo = true;
  }

  // Verde vacuo prohibido: si nadie lee la vista, este gate estaría vigilando que no se use una
  // relación que no usa nadie — y el terreno se habría quedado sin su configuración.
  if (!hayLectorDeLaVista) {
    console.error(
      `GATE: nadie en ${ARBOL} lee \`${VISTA}\`: la vista del §4.8 existe en la base y el ` +
        "terreno no la consume",
    );
    fallo = true;
  }

  console.log(
    `gate-terreno-sin-parametros: ${revisados} archivos de ${ARBOL} · ` +
      `${hallazgos.length} lecturas no declaradas de la tabla · ` +
      `${LEEN_LA_TABLA_A_PROPOSITO.size} declaradas`,
  );
  if (fallo) {
    console.error("gate-terreno-sin-parametros: ROJO");
    process.exit(1);
  }
  console.log("gate-terreno-sin-parametros: VERDE");
}
