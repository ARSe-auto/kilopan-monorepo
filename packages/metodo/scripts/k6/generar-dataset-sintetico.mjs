#!/usr/bin/env node
// generar-dataset-sintetico.mjs — «dataset sintético con generador versionado» [AC-FPOD-15].
//
// Produce la RECETA de los N dispositivos con turno abierto que pide la fila Capacidad del §0
// (`CAPACIDAD.dispositivos_con_turno_abierto`, hoy 2.000): un RUT sintético, una patente y un
// secreto de dispositivo por cada uno. Los UUID reales (persona, vehículo, turno, parada) los
// asigna la BD al sembrar (`sembrar-carga.mjs`, que sí necesita un cluster vivo); esta receta
// es la mitad que NO necesita base de datos y por eso puede vivir COMITEADA y versionada, igual
// que `db/flota/covering-array-parada.generado.json`.
//
// DETERMINISTA A PROPÓSITO (mismo motivo que `generar-covering-array.mjs`): cero
// `Math.random()`, PRNG propio con semilla fija. Dos corridas sobre el mismo N dan el
// MISMO archivo — si no, "generador versionado" no significaría nada: el `.generado.json`
// comiteado quedaría desincronizado de sí mismo en la siguiente corrida.
//
// RUTs SINTÉTICOS, NO DE LA LISTA CONGELADA (`db/flota/ruts-sinteticos.mjs`, ~35 RUTs):
// necesitamos miles, uno por dispositivo. Se computan con el mismo algoritmo módulo 11 que
// `rut_valido()` (0011_identidad_y_enrolamiento.sql) contra un cuerpo NUNCA asignado en Chile
// (90.000.000+, muy por delante del rango vigente) — sintácticamente válidos, imposibles de
// confundir con una persona real. Este archivo vive fuera del ALCANCE de
// `db/flota/gate-ruts.mjs` (que vigila apps/flota, db/flota, db/migraciones-flota,
// packages/nucleo-comun, packages/miga) porque no es un seed de producto: es la carga de un
// tenant de laboratorio que el nightly recrea en cada corrida.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CAPACIDAD } from "../../../nucleo-comun/src/constants.ts";

export const RUTA_GENERADO = new URL("./dataset-sintetico.generado.json", import.meta.url).pathname;

/** Semilla fija del PRNG. Cambiarla es una decisión visible (regenera TODO el archivo). */
export const SEMILLA = 0x464d3135; // "FM15" — AC-FPOD-15, ráfaga matinal

/** mulberry32: PRNG chico, determinista, suficiente para datos de laboratorio (no criptografía). */
function prng(semilla) {
  let estado = semilla >>> 0;
  return function siguiente() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dígito verificador módulo 11, idéntico al de `rut_valido()` (0011_identidad_y_enrolamiento.sql). */
function digitoVerificador(cuerpo) {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/** `12.345.678-9`, el formato canónico EXACTO que exige `rut_valido()` (§0 Formatos). */
function formatearRut(cuerpo) {
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${conPuntos}-${digitoVerificador(cuerpo)}`;
}

/** RUT sintético #i: cuerpo 90.000.000 + i — rango jamás asignado en Chile (§0 Formatos). */
export function rutSintetico(indice) {
  return formatearRut(String(90_000_000 + indice));
}

/** Patente sintética #i: mayúsculas/dígitos, 4-12 chars, sin guiones ni espacios (CHECK de `vehiculos`). */
export function patenteSintetica(indice) {
  return `K6RM${String(indice).padStart(3, "0")}`;
}

/** Secreto de dispositivo #i: determinista, 32 hex — MISMA forma que `secretoNuevo()` produce
 *  en tráfico real (una cadena opaca de portador), pero reproducible por semilla. Vale solo
 *  contra el tenant de laboratorio que el nightly recrea en cada corrida — jamás un secreto
 *  de producción. */
function secretoSintetico(rand) {
  let hex = "";
  for (let i = 0; i < 8; i++) hex += Math.floor(rand() * 0xffff).toString(16).padStart(4, "0");
  return hex;
}

/**
 * La receta completa: N filas determinista por `semilla`. Pura — sin tocar disco ni la BD —
 * para que el test de sincronía la pueda recomputar y comparar contra el `.generado.json`.
 */
export function generarDataset(n = CAPACIDAD.dispositivos_con_turno_abierto, semilla = SEMILLA) {
  const rand = prng(semilla);
  const dispositivos = [];
  for (let i = 0; i < n; i++) {
    dispositivos.push({
      indice: i,
      rut: rutSintetico(i),
      patente: patenteSintetica(i),
      secreto: secretoSintetico(rand),
    });
  }
  const shaSemilla = createHash("sha256").update(String(semilla), "utf8").digest("hex").slice(0, 16);
  return { semilla, shaSemilla, n, dispositivos };
}

function esModuloPrincipal() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (esModuloPrincipal()) {
  const doc = generarDataset();
  writeFileSync(RUTA_GENERADO, JSON.stringify(doc) + "\n");
  console.log(`generar-dataset-sintetico: escrito ${RUTA_GENERADO} (${doc.n} dispositivos)`);
}
