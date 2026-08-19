#!/usr/bin/env node
// Mutantes del gate «el terreno lee la vista»: cada uno planta el defecto que existe para
// atrapar. [AC-FTAR-17]
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  leeLaTabla,
  leeLaVista,
  revisar,
  ARBOL,
  LEEN_LA_TABLA_A_PROPOSITO,
} from "./gate-terreno-sin-parametros.mjs";

/** Un árbol de mentira con los archivos que se le pidan, para correr el gate de verdad contra él. */
function arbolCon(archivos) {
  const raiz = mkdtempSync(join(tmpdir(), "gate-terreno-parametros-"));
  for (const [rel, contenido] of Object.entries(archivos)) {
    const ruta = join(raiz, rel);
    mkdirSync(join(ruta, ".."), { recursive: true });
    writeFileSync(ruta, contenido);
  }
  return raiz;
}

const LECTURA_DE_LA_VISTA =
  'const q = "select bultos_max_sin_receptor from parametros_operativos limit 1";\n';

test("[AC-FTAR-17] leer la TABLA dispara, en las dos formas de entrar a una consulta", () => {
  assert.equal(leeLaTabla('"select bultos_max_sin_receptor from parametros limit 1"'), true);
  assert.equal(leeLaTabla("`left join parametros p on true`"), true);
  assert.equal(leeLaTabla("select anticipacion_vencimiento_dias FROM Parametros"), true);
});

test("[AC-FTAR-17] leer la VISTA no dispara: `\\b` no cierra antes de un `_`", () => {
  assert.equal(leeLaTabla('"select reserva_pct from parametros_operativos"'), false);
  assert.equal(leeLaTabla("`left join parametros_operativos p on true`"), false);
  assert.equal(leeLaVista('"select reserva_pct from parametros_operativos"'), true);
});

test("[AC-FTAR-17] NOMBRAR la tabla no es leerla: la prosa y los tipos siguen pudiendo decirlo", () => {
  assert.equal(leeLaTabla("bultosMaxSinReceptor={parametrosFilas[0]?.bultos_max_sin_receptor}"), false);
  assert.equal(leeLaTabla("insert into parametros (tarifa_kwh_clp) values ($1)"), false);
  assert.equal(leeLaTabla("const parametros = new URLSearchParams(window.location.search);"), false);
});

test("[AC-FTAR-17] el defecto plantado —la pantalla del chofer leyendo la tabla— se atrapa", () => {
  const raiz = arbolCon({
    [`${ARBOL}/app/entrega/page.tsx`]:
      'const q = "select bultos_max_sin_receptor from parametros limit 1";\n',
    [`${ARBOL}/app/ruta/page.tsx`]: LECTURA_DE_LA_VISTA,
  });
  const { hallazgos, hayLectorDeLaVista } = revisar(raiz, ARBOL, new Map());
  assert.equal(hallazgos.length, 1);
  assert.equal(hallazgos[0].rel, `${ARBOL}/app/entrega/page.tsx`);
  assert.equal(hallazgos[0].linea, 1);
  assert.equal(hayLectorDeLaVista, true);
});

test("[AC-FTAR-17] un comentario que explica por qué NO se lee la tabla no es leerla", () => {
  const raiz = arbolCon({
    [`${ARBOL}/app/entrega/page.tsx`]:
      "// sale de la vista y no de `select ... from parametros`, que traería la plata (§4.8)\n" +
      LECTURA_DE_LA_VISTA,
  });
  assert.deepEqual(revisar(raiz, ARBOL, new Map()).hallazgos, []);
});

test("[AC-FTAR-17] el lector DECLARADO pasa, y solo él", () => {
  const declarados = new Map([[`${ARBOL}/servidor/tablero.ts`, "el tablero es del operador"]]);
  const raiz = arbolCon({
    [`${ARBOL}/servidor/tablero.ts`]: "`left join parametros p on true`\n",
    [`${ARBOL}/servidor/otro.ts`]: "`left join parametros p on true`\n",
    [`${ARBOL}/app/entrega/page.tsx`]: LECTURA_DE_LA_VISTA,
  });
  const { hallazgos, declaracionesMuertas } = revisar(raiz, ARBOL, declarados);
  assert.deepEqual(
    hallazgos.map((h) => h.rel),
    [`${ARBOL}/servidor/otro.ts`],
  );
  assert.deepEqual(declaracionesMuertas, []);
});

test("[AC-FTAR-17] una excepción que sobrevivió a su motivo se pone roja", () => {
  const declarados = new Map([[`${ARBOL}/servidor/tablero.ts`, "el tablero es del operador"]]);
  const raiz = arbolCon({
    [`${ARBOL}/servidor/tablero.ts`]: "`left join parametros_operativos p on true`\n",
    [`${ARBOL}/app/entrega/page.tsx`]: LECTURA_DE_LA_VISTA,
  });
  const { hallazgos, declaracionesMuertas } = revisar(raiz, ARBOL, declarados);
  assert.deepEqual(hallazgos, []);
  assert.deepEqual(declaracionesMuertas, [`${ARBOL}/servidor/tablero.ts`]);
});

test("[AC-FTAR-17] verde vacuo: un árbol donde nadie lee la vista NO es un árbol sano", () => {
  const raiz = arbolCon({ [`${ARBOL}/app/ruta/page.tsx`]: "export const x = 1;\n" });
  assert.equal(revisar(raiz, ARBOL, new Map()).hayLectorDeLaVista, false);
});

// Y el árbol DE VERDAD, que es el que el gate defiende: sin esto, los mutantes probarían un
// gate correcto sobre un repo que ya rompió la regla.
test("[AC-FTAR-17] el repo real: el terreno lee la vista y nadie lee la tabla sin declararlo", () => {
  const { hallazgos, declaracionesMuertas, hayLectorDeLaVista, revisados } = revisar();
  assert.deepEqual(hallazgos, []);
  assert.deepEqual(declaracionesMuertas, []);
  assert.equal(hayLectorDeLaVista, true);
  assert.ok(revisados > 0, `${ARBOL} no tiene archivos: el gate no estaría revisando nada`);
  assert.ok(LEEN_LA_TABLA_A_PROPOSITO.size >= 1);
});
