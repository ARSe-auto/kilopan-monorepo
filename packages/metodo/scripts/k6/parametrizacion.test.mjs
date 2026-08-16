#!/usr/bin/env node
// Sincronía de los dos generadores versionados del k6 «ráfaga matinal» [AC-FPOD-15]: mismo
// patrón que `db/flota/gate-covering-array-parada.mjs` — recomputar y comparar byte a byte
// contra el `.generado.json` comiteado. Corre en el gate RÁPIDO (sin BD, sin binario k6):
// lo que valida es que la parametrización sale de UNA fuente (§0) y que el dataset sintético
// es reproducible, no la carga real contra un servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPACIDAD } from "../../../nucleo-comun/src/constants.ts";
import { generarParametros, RUTA_GENERADO as RUTA_PARAMS } from "./generar-parametros.mjs";
import { generarDataset, rutSintetico, RUTA_GENERADO as RUTA_DATASET } from "./generar-dataset-sintetico.mjs";

test("parametros.generado.json está sincronizado con CAPACIDAD (§0, fuente única)", () => {
  const comiteado = JSON.parse(readFileSync(RUTA_PARAMS, "utf8"));
  assert.deepEqual(comiteado, generarParametros());
});

test("los umbrales que FALLAN el pipeline son los del §0, ni más laxos ni copiados a mano", () => {
  const { capacidad } = generarParametros();
  assert.equal(capacidad.p95_bootstrap_ms, 400);
  assert.equal(capacidad.p95_sync_ms, 250);
  assert.equal(capacidad.dispositivos_con_turno_abierto, 2000);
  assert.equal(capacidad.usuarios_concurrentes_por_celula, 5000);
  assert.equal(capacidad.replays_por_segundo, 100);
});

test("dataset-sintetico.generado.json está sincronizado con su generador (determinista)", () => {
  const comiteado = JSON.parse(readFileSync(RUTA_DATASET, "utf8"));
  const recienGenerado = generarDataset();
  assert.deepEqual(comiteado, recienGenerado);
});

test("el dataset trae exactamente N=CAPACIDAD.dispositivos_con_turno_abierto filas, RUTs únicos y válidos", () => {
  const { dispositivos } = generarDataset();
  assert.equal(dispositivos.length, CAPACIDAD.dispositivos_con_turno_abierto);
  const ruts = new Set(dispositivos.map((d) => d.rut));
  assert.equal(ruts.size, dispositivos.length, "RUT repetido entre dispositivos sintéticos");
  for (const d of dispositivos) {
    assert.match(d.rut, /^\d{1,3}(\.\d{3})+-[\dK]$/);
    assert.match(d.patente, /^[A-Z0-9]{4,12}$/);
    assert.match(d.secreto, /^[0-9a-f]{32}$/);
  }
});

test("el módulo 11 del RUT sintético calza con el algoritmo de rut_valido() (0011_identidad_y_enrolamiento.sql)", () => {
  // Casos ancla contra dígitos verificadores conocidos, mismo algoritmo que la BD.
  assert.equal(rutSintetico(0), "90.000.000-6");
  // Reproducible: dos llamadas con el mismo índice dan el mismo RUT.
  assert.equal(rutSintetico(837), rutSintetico(837));
});

test("distinta semilla ⇒ distinto dataset (el determinismo depende de la semilla, no la ignora)", () => {
  const a = generarDataset(10, 1);
  const b = generarDataset(10, 2);
  assert.notDeepEqual(a.dispositivos, b.dispositivos);
});
