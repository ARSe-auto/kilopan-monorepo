import { test } from "node:test";
import assert from "node:assert/strict";
import { resultadoDeItem, fechaCalendarioEsCl, filasACsv, type FilaExportPod } from "./export-pods.ts";

// [AC-FTEL-07] Export de PODs por rango — §11 punto 4.

test("resultado por ítem: NULL es pendiente, nunca cero (0037: NULL no es cero)", () => {
  assert.equal(resultadoDeItem(6, null), "pendiente");
});

test("resultado por ítem: todo lo planificado entregado es éxito", () => {
  assert.equal(resultadoDeItem(6, 6), "exito");
});

test("resultado por ítem: entre medio es parcial", () => {
  assert.equal(resultadoDeItem(6, 2), "parcial");
});

test("resultado por ítem: cero entregado es la devolución completa (fallo)", () => {
  assert.equal(resultadoDeItem(6, 0), "fallo");
});

test("fecha calendario: split de texto, no Date+huso — no se corre un día", () => {
  // Si pasara por `fechaEsCl` con America/Santiago, la medianoche UTC de este `Date` se leería
  // como el día anterior. Acá no hay huso que resolver: el string ya es el día exacto.
  assert.equal(fechaCalendarioEsCl("2026-08-19"), "19-08-2026");
  assert.equal(fechaCalendarioEsCl("2026-01-01"), "01-01-2026");
});

function fila(parcial: Partial<FilaExportPod> = {}): FilaExportPod {
  return {
    fecha_servicio: "2026-08-19",
    empresa: "Panadería Central SpA",
    encargo_id: "11111111-1111-1111-1111-111111111111",
    destino: "Bodega Ñuñoa",
    bultos_planificados: 6,
    bultos_entregados: 6,
    bultos_rechazados: 0,
    evidencia_tipo: "foto",
    evidencia_sha256: "a3f5",
    ...parcial,
  };
}

test("CSV: encabezado con `;` y la columna temperatura reservada al final", () => {
  const csv = filasACsv([]);
  const encabezado = csv.split("\n")[0];
  assert.equal(
    encabezado,
    "fecha;empresa;encargo_id;destino;bultos_planificados;bultos_entregados;bultos_rechazados;resultado_item;evidencia_tipo;evidencia_sha256;temperatura",
  );
});

test("CSV: una fila con fecha dd-mm-aaaa, separador `;` y temperatura vacía", () => {
  const csv = filasACsv([fila()]);
  const [, linea] = csv.split("\n");
  assert.equal(
    linea,
    "19-08-2026;Panadería Central SpA;11111111-1111-1111-1111-111111111111;Bodega Ñuñoa;6;6;0;exito;foto;a3f5;",
  );
});

test("CSV: sin binario, el hash sale vacío y no 'null'", () => {
  const csv = filasACsv([fila({ evidencia_tipo: "firma", evidencia_sha256: null })]);
  const [, linea] = csv.split("\n");
  assert.match(linea, /;firma;;$/);
});

test("CSV: un nombre de destino con `;` adentro se cita, no se rompe la columna", () => {
  const csv = filasACsv([fila({ destino: "Local A; Bodega trasera" })]);
  const [, linea] = csv.split("\n");
  const columnas = linea!.match(/(".*?"|[^;]*)(;|$)/g)!.filter(Boolean);
  assert.equal(columnas[3], '"Local A; Bodega trasera";');
});

test("CSV: entrega parcial y devolución completa se distinguen en resultado_item", () => {
  const csv = filasACsv([
    fila({ encargo_id: "22222222-2222-2222-2222-222222222222", bultos_entregados: 2, bultos_rechazados: 4 }),
    fila({ encargo_id: "33333333-3333-3333-3333-333333333333", bultos_entregados: 0, bultos_rechazados: 6 }),
  ]);
  const lineas = csv.split("\n").slice(1);
  assert.match(lineas[0]!, /;parcial;/);
  assert.match(lineas[1]!, /;fallo;/);
});
