import test from "node:test";
import assert from "node:assert/strict";
import { clasificacionDesdeComentario } from "./clasificacion-tablas.ts";

// [AC-FPOD-20] — §4.2. El parser puro que traduce el `COMMENT ON TABLE` a la clase que declara;
// la lectura real contra la BD vive en `servidor/clasificacion-tablas.ts` (no testeable acá sin
// un cluster — este archivo prueba solo la traducción del texto).

test("[AC-FPOD-20] tabla PLANIFICACIÓN — prefijo real de turnos/bloques_agenda", () => {
  assert.equal(
    clasificacionDesdeComentario(
      "PLANIFICACIÓN — el vehículo-día del §4.5. La apertura ONLINE rebota 422 con 0 filas si ...",
    ),
    "PLANIFICACION",
  );
});

test("[AC-FPOD-20] tabla CAPTURA — prefijo real de eventos/evidence", () => {
  assert.equal(
    clasificacionDesdeComentario("CAPTURA — hechos del terreno. Entran siempre (2xx + flag, §4.2) ..."),
    "CAPTURA",
  );
});

test("[AC-FPOD-20] insensible a mayúsculas/minúsculas", () => {
  assert.equal(clasificacionDesdeComentario("planificación — algo"), "PLANIFICACION");
  assert.equal(clasificacionDesdeComentario("captura — algo"), "CAPTURA");
});

test("[AC-FPOD-20] sin comentario ⇒ null, JAMÁS CAPTURA por omisión", () => {
  assert.equal(clasificacionDesdeComentario(null), null);
  assert.equal(clasificacionDesdeComentario(""), null);
});

test("[AC-FPOD-20] comentario que no declara ninguna de las dos clases ⇒ null", () => {
  assert.equal(clasificacionDesdeComentario("una tabla cualquiera sin clase declarada"), null);
});

test("[AC-FPOD-20] PLANIFICACION sin tilde no es la clase declarada — el linter exige el acento real", () => {
  // `db/flota/lint-migraciones.mjs` exige el prefijo exacto con tilde (CLASES). Un comentario que
  // lo omitiera no pasaría el gate de migraciones, así que esta rama documenta que el parser de
  // runtime es igual de estricto: no inventa una clase que la migración no dejó dicha.
  assert.equal(clasificacionDesdeComentario("PLANIFICACION — sin tilde"), null);
});
