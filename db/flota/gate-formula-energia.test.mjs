#!/usr/bin/env node
// Mutantes del grep-gate de la fórmula de energía [AC-FVEH-09].
//
// Un gate que solo se prueba contra el repo sano es un gate del que nadie sabe si dispara.
// Acá se planta el defecto que existe para atrapar —la fórmula escrita en otro archivo— en un
// SANDBOX, nunca en el árbol real, y se verifica también la otra mitad: que NOMBRAR un símbolo
// sin operarlo siga siendo legal, porque si no lo fuera nadie podría declarar la columna.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CANONICO, operaConLaFamilia, sinComentariosDeBloque, SIMBOLOS } from "./gate-formula-energia.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const GATE = join(RAIZ, "db/flota/gate-formula-energia.mjs");

/** Un repo de juguete con el archivo canónico real y los archivos que se le pidan. */
function sandbox(archivos = {}, { conCanonico = true } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-energia-"));
  if (conCanonico) {
    mkdirSync(join(raiz, "packages/nucleo-comun/src"), { recursive: true });
    cpSync(join(RAIZ, CANONICO), join(raiz, CANONICO));
  }
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(join(raiz, rel, ".."), { recursive: true });
    writeFileSync(join(raiz, rel), contenido);
  }
  return raiz;
}

function correr(raiz) {
  try {
    return { codigo: 0, salida: execFileSync("node", [GATE, `--raiz=${raiz}`], { encoding: "utf8" }) };
  } catch (e) {
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("el repo real pasa el gate", () => {
  try {
    assert.match(execFileSync("node", [GATE], { encoding: "utf8" }), /gate-formula-energia: VERDE/);
  } catch (e) {
    assert.fail(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});

test("la fórmula escrita en OTRO archivo ⇒ ROJO", () => {
  const raiz = sandbox({
    "apps/flota/.fixture-tablero.ts": "export const rango = autonomiaNominalKm * sohPct;\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1);
  assert.match(salida, /\.fixture-tablero\.ts:1/, "debe señalar el archivo y la línea exactos");
  assert.match(salida, /autonomiaNominalKm/);
});

test("restar la reserva por fuera ⇒ ROJO — es EL defecto que este gate existe para atrapar", () => {
  const raiz = sandbox({
    "apps/flota/.fixture-semaforo.ts": "const alcance = disponible - reservaKm;\n",
  });
  assert.equal(correr(raiz).codigo, 1);
});

test("NOMBRAR un símbolo sin operarlo sigue siendo legal", () => {
  // Si no lo fuera, no se podría declarar la columna en el DDL ni leerla en un test, y el gate
  // se volvería impracticable — que es la forma más rápida de que alguien lo apague.
  const raiz = sandbox({
    "db/migraciones-flota/tenant/.fixture.sql": "alter table vehiculos add column autonomia_nominal_km int;\n",
    "apps/flota/.fixture-lectura.ts": "const { sohPct, reservaKm } = ficha;\n",
    "apps/flota/.fixture-json.ts": 'const cuerpo = { max_distance: 0, rango_efectivo: 0 };\n',
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("la fórmula EXPLICADA en un comentario de bloque no dispara", () => {
  // Pasó de verdad: el propio `constants.ts` escribe la fórmula en un bloque para explicarla,
  // y el gate se puso rojo contra el árbol sano. Un guard que castiga documentar se apaga solo.
  const raiz = sandbox({
    "apps/flota/.fixture-doc.ts": "/**\n * rango_efectivo = autonomia_nominal_km * soh_pct\n */\nexport const x = 1;\n",
    "apps/flota/.fixture-doc-linea.ts": "// alcance = rangoEfectivo - reservaKm\nexport const y = 2;\n",
    "db/migraciones-flota/tenant/.fixture-doc.sql": "-- max_distance = soc * rango_efectivo - reserva_km\nselect 1;\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("sin el archivo canónico el gate se pone ROJO (verde vacuo prohibido)", () => {
  const raiz = sandbox({}, { conCanonico: false });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1);
  assert.match(salida, /no vigilaría nada/);
});

test("cada símbolo vigilado dispara de verdad contra una expresión que lo opera", () => {
  // Sin esto, un símbolo mal escrito en la lista quedaría sin vigilancia y el gate seguiría en
  // verde: la lista parecería completa y no protegería nada.
  for (const simbolo of SIMBOLOS) {
    assert.equal(
      operaConLaFamilia(`const x = base * ${simbolo};`),
      simbolo,
      `el patrón de ${simbolo} no dispara con un producto`,
    );
    assert.equal(
      operaConLaFamilia(`const x = ${simbolo} - margen;`),
      simbolo,
      `el patrón de ${simbolo} no dispara con una resta`,
    );
  }
});

test("los comentarios de bloque se vacían sin correr los números de línea", () => {
  const texto = "uno\n/* dos\n   tres */\ncuatro\n";
  const limpio = sinComentariosDeBloque(texto);
  assert.equal(limpio.split("\n").length, texto.split("\n").length, "se perdió una línea");
  assert.equal(limpio.split("\n")[3], "cuatro");
  assert.equal(limpio.split("\n")[1].trim(), "");
});
