#!/usr/bin/env node
// generar-covering-array.mjs — covering array 2-way propio, sin binario externo [AC-FPOD-18].
//
// No hay `pict` (la herramienta de Microsoft) instalable en el runner del motor: es un binario
// nativo que este repo no puede traer ni versionar. En vez de una dependencia opaca, esta es
// la implementación — chica a propósito, porque el espacio de este archivo (8 factores, ≤3
// valores cada uno) cabe entero en memoria: enumerar TODAS las filas válidas por fuerza bruta
// (cartesiano filtrado por restricciones) y después cubrir sus pares con un greedy determinista
// es más simple y más verificable que un solver general, y acá alcanza.
//
// ─── EL CONTRATO CON EL GATE ──────────────────────────────────────────────────────
//
// `sha256Del(textoPict)` viaja DENTRO del array generado. El gate (gate-covering-array-
// parada.mjs) recalcula el array desde el `.pict` que está en el árbol y lo compara contra el
// `.json` comiteado — byte a byte, hash incluido. Agregar un factor sin correr este script dos
// veces produce un array distinto (más factores ⇒ más pares ⇒ otras filas) y un hash de fuente
// distinto: las dos discrepancias bastan solas para poner el gate en rojo.
//
// Determinista a propósito: cero `Math.random()`, orden de iteración fijo (el de declaración
// de factores y valores en el `.pict`, y el de aparición de las filas válidas en el cartesiano).
// Sin esto, dos corridas sobre el MISMO `.pict` generarían arrays distintos y el gate quedaría
// rojo con el archivo recién regenerado — el peor lugar para un no-determinismo.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const RUTA_PICT = `${RAIZ}/db/flota/covering-array-parada.pict`;
export const RUTA_GENERADO = `${RAIZ}/db/flota/covering-array-parada.generado.json`;

/** El sha256 hex del texto fuente, tal cual viaja en el `.json` generado. */
export function sha256Del(texto) {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/**
 * Parsea el `.pict`: líneas de factor (`nombre: v1, v2, v3;` opcional el `;` final) y
 * restricciones `if [F] = "v" then [G] <> "w";` / `... = "w";`. Comentarios `#` y líneas en
 * blanco se ignoran. No es un parser general de la sintaxis de Microsoft PICT completa — cubre
 * el subconjunto que este archivo usa, que es lo único que hay que sostener.
 */
export function parsearPict(texto) {
  const factores = [];
  const restricciones = [];
  const nombresFactor = new Set();

  for (const crudo of texto.split("\n")) {
    const linea = crudo.replace(/#.*$/, "").trim();
    if (linea.length === 0) continue;

    const mRestriccion = linea.match(
      /^if\s+\[(\w+)\]\s*=\s*"([^"]+)"\s+then\s+\[(\w+)\]\s*(<>|=)\s*"([^"]+)"\s*;?\s*$/,
    );
    if (mRestriccion) {
      const [, siFactor, siValor, entoncesFactor, operador, entoncesValor] = mRestriccion;
      restricciones.push({ siFactor, siValor, entoncesFactor, operador, entoncesValor });
      continue;
    }

    const mFactor = linea.match(/^(\w+)\s*:\s*(.+?)\s*;?\s*$/);
    if (mFactor) {
      const [, nombre, listaValores] = mFactor;
      if (nombresFactor.has(nombre)) {
        throw new Error(`generar-covering-array: factor duplicado «${nombre}» en el .pict`);
      }
      nombresFactor.add(nombre);
      const valores = listaValores.split(",").map((v) => v.trim());
      factores.push({ nombre, valores });
      continue;
    }

    throw new Error(`generar-covering-array: línea del .pict que no calza ningún patrón: «${crudo}»`);
  }

  // Toda restricción referencia factores DECLARADOS: una que apunte a un factor que ya no
  // existe (renombrado, borrado) es un .pict inconsistente, no un caso a tolerar en silencio.
  for (const r of restricciones) {
    if (!nombresFactor.has(r.siFactor)) {
      throw new Error(`generar-covering-array: restricción referencia factor inexistente «${r.siFactor}»`);
    }
    if (!nombresFactor.has(r.entoncesFactor)) {
      throw new Error(`generar-covering-array: restricción referencia factor inexistente «${r.entoncesFactor}»`);
    }
  }

  return { factores, restricciones };
}

/** ¿Esta asignación COMPLETA respeta la restricción? */
function respetaRestriccion(asignacion, r) {
  if (asignacion[r.siFactor] !== r.siValor) return true;
  const valorActual = asignacion[r.entoncesFactor];
  return r.operador === "<>" ? valorActual !== r.entoncesValor : valorActual === r.entoncesValor;
}

export function esFilaValida(asignacion, restricciones) {
  return restricciones.every((r) => respetaRestriccion(asignacion, r));
}

/**
 * Todas las filas COMPLETAS que respetan cada restricción, por fuerza bruta sobre el
 * cartesiano de valores. El orden es el de declaración (factores en el orden del .pict, valores
 * en el orden en que aparecen en su lista) — es lo que hace determinista el resto del pipeline.
 */
export function filasValidas(factores, restricciones) {
  let filas = [{}];
  for (const factor of factores) {
    const siguiente = [];
    for (const base of filas) {
      for (const valor of factor.valores) siguiente.push({ ...base, [factor.nombre]: valor });
    }
    filas = siguiente;
  }
  return filas.filter((f) => esFilaValida(f, restricciones));
}

/** La llave canónica de un par (factorA=valorA, factorB=valorB), para usar como clave de Set/Map. */
function llaveDePar(nombreA, valorA, nombreB, valorB) {
  return `${nombreA}=${valorA}|${nombreB}=${valorB}`;
}

/**
 * Los pares REQUERIDOS: por cada dos factores distintos y cada combinación de sus valores, el
 * par entra si EXISTE al menos una fila válida que lo realiza. Un par que ninguna fila válida
 * alcanza (imposible de verdad, aunque las restricciones que lo prohíben sean indirectas — dos
 * o tres saltos, como terminado⇒llegada=no⇒modo=elegir) queda afuera solo porque no aparece en
 * ninguna fila de `filasValidas`, sin tener que razonar la cadena de restricciones a mano.
 */
export function paresRequeridos(factores, filas) {
  const pares = new Map();
  for (let i = 0; i < factores.length; i++) {
    for (let j = i + 1; j < factores.length; j++) {
      const a = factores[i];
      const b = factores[j];
      const alcanzados = new Set();
      for (const fila of filas) alcanzados.add(llaveDePar(a.nombre, fila[a.nombre], b.nombre, fila[b.nombre]));
      for (const va of a.valores) {
        for (const vb of b.valores) {
          const llave = llaveDePar(a.nombre, va, b.nombre, vb);
          if (alcanzados.has(llave)) pares.set(llave, { factorA: a.nombre, valorA: va, factorB: b.nombre, valorB: vb });
        }
      }
    }
  }
  return pares;
}

/** Los pares que UNA fila cubre (todas las combinaciones de a dos de sus propios valores). */
function paresDeLaFila(factores, fila) {
  const llaves = [];
  for (let i = 0; i < factores.length; i++) {
    for (let j = i + 1; j < factores.length; j++) {
      const a = factores[i];
      const b = factores[j];
      llaves.push(llaveDePar(a.nombre, fila[a.nombre], b.nombre, fila[b.nombre]));
    }
  }
  return llaves;
}

/**
 * Greedy determinista de cobertura de pares (mismo principio que AETG/IPOG, sin su
 * sofisticación): mientras queden pares sin cubrir, elegir —entre las filas válidas, en su
 * orden fijo— la que cubre MÁS pares todavía sin cubrir; empate se rompe por la primera en ese
 * orden. Nunca aleatorio: dos corridas sobre el mismo .pict tienen que producir el MISMO array,
 * porque el gate compara el array comiteado contra uno recién generado.
 */
export function generarCoveringArray(factores, restricciones) {
  const filas = filasValidas(factores, restricciones);
  const requeridos = paresRequeridos(factores, filas);
  const sinCubrir = new Set(requeridos.keys());
  const filasConPares = filas.map((fila) => ({ fila, pares: paresDeLaFila(factores, fila) }));

  const elegidas = [];
  while (sinCubrir.size > 0) {
    let mejor = null;
    let mejorCobertura = -1;
    for (const { fila, pares } of filasConPares) {
      let cobertura = 0;
      for (const p of pares) if (sinCubrir.has(p)) cobertura++;
      if (cobertura > mejorCobertura) {
        mejorCobertura = cobertura;
        mejor = { fila, pares };
      }
    }
    if (mejor === null || mejorCobertura === 0) {
      // No debería pasar: `requeridos` solo contiene pares que alguna fila válida realiza. Si
      // esto dispara, hay un defecto en `paresRequeridos`/`filasValidas`, no un .pict raro.
      throw new Error("generar-covering-array: quedan pares sin cubrir y ninguna fila los cubre");
    }
    elegidas.push(mejor.fila);
    for (const p of mejor.pares) sinCubrir.delete(p);
  }
  return { filas: elegidas, totalParesRequeridos: requeridos.size, totalFilasValidas: filas.length };
}

/** El objeto completo que viaja al `.json` comiteado — lo que el gate compara. */
export function generarDocumento(textoPict) {
  const { factores, restricciones } = parsearPict(textoPict);
  const { filas, totalParesRequeridos, totalFilasValidas } = generarCoveringArray(factores, restricciones);
  return {
    version: 2,
    shaPict: sha256Del(textoPict),
    factores: factores.map((f) => f.nombre),
    totalParesRequeridos,
    totalFilasValidas,
    filas,
  };
}

function main() {
  const textoPict = readFileSync(RUTA_PICT, "utf8");
  const documento = generarDocumento(textoPict);
  writeFileSync(RUTA_GENERADO, `${JSON.stringify(documento, null, 2)}\n`);
  console.log(
    `generar-covering-array: ${documento.filas.length} filas cubren ${documento.totalParesRequeridos} ` +
      `pares requeridos (de ${documento.totalFilasValidas} filas válidas posibles) → ${RUTA_GENERADO}`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
