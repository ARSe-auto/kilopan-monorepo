import { test } from "node:test";
import assert from "node:assert/strict";
import { DPA_VERSION, DPA_RUTA, DPA_SECCIONES } from "./dpa.ts";

// El DPA como artefacto VERSIONADO del repo [AC-FMIG-22] — §3.E1.15, §7.8.
//
// Este es el «test CI grep-able de existencia y de secciones mínimas» que pide el AC: no valida
// prosa legal (eso lo bloquea la Pregunta al dueño 12), valida que las SIETE secciones que el
// texto del AC nombra literalmente —partes, objeto del tratamiento, encargado/responsable,
// subencargados, medidas de seguridad, devolución/supresión al término y portabilidad
// `pg_dump`— existen con contenido real, no un hueco ni un `hueco de relleno`.

const SECCIONES_MINIMAS = [
  "partes",
  "objeto",
  "encargado_responsable",
  "subencargados",
  "seguridad",
  "devolucion_y_supresion",
  "portabilidad",
] as const;

test("las siete secciones mínimas del AC existen, cada una con id, título y cuerpo [AC-FMIG-22]", () => {
  const ids = DPA_SECCIONES.map((s) => s.id);
  for (const minima of SECCIONES_MINIMAS) {
    assert.ok(ids.includes(minima), `falta la sección «${minima}»`);
  }
  for (const seccion of DPA_SECCIONES) {
    assert.ok(seccion.titulo.trim().length > 0, `sección «${seccion.id}» sin título`);
    // Cuerpo real: ni vacío ni un hueco de menos de una oración — un documento legal con una
    // sección de 3 caracteres es tan inservible como una sección ausente.
    assert.ok(seccion.cuerpo.trim().length >= 80, `sección «${seccion.id}» con cuerpo insuficiente`);
  }
});

test("la sección de portabilidad cita pg_dump — §2 métrica 7 [AC-FMIG-22]", () => {
  const portabilidad = DPA_SECCIONES.find((s) => s.id === "portabilidad");
  assert.ok(portabilidad, "falta la sección de portabilidad");
  assert.match(portabilidad!.cuerpo, /pg_dump/);
});

test("la base de licitud es ejecución de contrato, jamás consentimiento del trabajador [AC-FMIG-22] — §7.8", () => {
  const seccion = DPA_SECCIONES.find((s) => s.id === "encargado_responsable");
  assert.ok(seccion, "falta la sección encargado/responsable");
  assert.match(seccion!.cuerpo, /ejecución del contrato/);
  assert.match(seccion!.cuerpo, /jamás el consentimiento/);
});

test("cero strings visibles en inglés y cero hueco de relleno [AC-FMIG-22] — §0", () => {
  const TOKENS_VEDADOS = /\b(TODO|FIXME|hueco de relleno|not implemented|lorem ipsum)\b/i;
  for (const seccion of DPA_SECCIONES) {
    assert.doesNotMatch(seccion.titulo, TOKENS_VEDADOS, `título de «${seccion.id}»`);
    assert.doesNotMatch(seccion.cuerpo, TOKENS_VEDADOS, `cuerpo de «${seccion.id}»`);
  }
});

test("la versión es un string no vacío — lo que la aceptación graba en audit_trail [AC-FMIG-22] — §4.6", () => {
  assert.ok(typeof DPA_VERSION === "string" && DPA_VERSION.trim().length > 0);
});

test("la ruta del panel admin queda a profundidad ≤2 [AC-FMIG-22] — §5.1", () => {
  const niveles = DPA_RUTA.split("/").filter(Boolean).length;
  assert.ok(niveles <= 2, `«${DPA_RUTA}» tiene ${niveles} niveles`);
});
