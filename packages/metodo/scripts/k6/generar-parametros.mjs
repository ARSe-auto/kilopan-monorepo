#!/usr/bin/env node
// generar-parametros.mjs — fuente ÚNICA de los umbrales y la forma de carga del k6 «ráfaga
// matinal» [AC-FPOD-15] — §0 (fila Capacidad), §9.2.
//
// El k6 no puede importar TypeScript (corre en goja, sin type-stripping ni resolución de
// módulos de Node), así que la fila Capacidad no puede leerse DIRECTO desde
// `packages/nucleo-comun/src/constants.ts` en tiempo de ejecución del script k6. Este
// generador es el puente: importa la constante UNA vez, en Node, y la vuelca a un JSON
// comiteado que el k6 lee con `open()`. Mismo patrón que `db/flota/generar-covering-array.mjs`
// (artefacto generado + comiteado, nunca escrito a mano) — así un cambio en `CAPACIDAD` se
// propaga con "correr el generador y comitear", no editando dos archivos a mano que un día
// divergen.
import { writeFileSync } from "node:fs";
import { CAPACIDAD } from "../../../nucleo-comun/src/constants.ts";

export const RUTA_GENERADO = new URL("./parametros.generado.json", import.meta.url).pathname;

/** Documento determinista: mismo `CAPACIDAD` ⇒ mismo JSON, byte a byte. */
export function generarParametros() {
  return {
    fuente: "packages/nucleo-comun/src/constants.ts#CAPACIDAD",
    capacidad: { ...CAPACIDAD },
  };
}

function esModuloPrincipal() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (esModuloPrincipal()) {
  const doc = generarParametros();
  writeFileSync(RUTA_GENERADO, JSON.stringify(doc, null, 2) + "\n");
  console.log(`generar-parametros: escrito ${RUTA_GENERADO}`);
}
