import test from "node:test";
import assert from "node:assert/strict";
import { LABELS } from "../../../../packages/nucleo-comun/src/constants.ts";
import { TERMINOLOGIA_BASE, TERMINOLOGIA_EXTREMA_TENANT_B, resolverTerminologia } from "./hoy-terminologia.ts";

// Terminología del Nivel 0 de «Hoy» [AC-FSEM-12] — la variante «extrema» del tenant B tiene que
// quedar DENTRO del largo que `tenant_terminology` (AC-FTEN-10) realmente aceptaría, o el caso
// que este AC prueba no sería uno que el sistema real pudiera guardar.

test("resolverTerminologia: 'extremo' resuelve la variante tenant B, cualquier otra cosa resuelve la base", () => {
  assert.equal(resolverTerminologia("extremo"), TERMINOLOGIA_EXTREMA_TENANT_B);
  assert.equal(resolverTerminologia("base"), TERMINOLOGIA_BASE);
  assert.equal(resolverTerminologia(undefined), TERMINOLOGIA_BASE);
});

test("la extrema es de verdad MÁS LARGA que la base en cada campo — si no, no prueba nada", () => {
  for (const color of ["verde", "amarillo", "rojo"] as const) {
    assert.ok(
      TERMINOLOGIA_EXTREMA_TENANT_B.etiquetaColor[color].length > TERMINOLOGIA_BASE.etiquetaColor[color].length,
      `etiquetaColor.${color} extrema no es más larga que la base`,
    );
  }
  assert.ok(TERMINOLOGIA_EXTREMA_TENANT_B.excepcionPlural.length > TERMINOLOGIA_BASE.excepcionPlural.length);
});

test("la extrema respeta LABELS.largo_max — el CHECK real de tenant_terminology la aceptaría", () => {
  for (const texto of Object.values(TERMINOLOGIA_EXTREMA_TENANT_B.etiquetaColor)) {
    assert.ok(texto.length <= LABELS.largo_max.navegacion, `"${texto}" excede navegacion (${LABELS.largo_max.navegacion})`);
  }
  assert.ok(TERMINOLOGIA_EXTREMA_TENANT_B.excepcionSingular.length <= LABELS.largo_max.titulo);
  assert.ok(TERMINOLOGIA_EXTREMA_TENANT_B.excepcionPlural.length <= LABELS.largo_max.titulo);
});
