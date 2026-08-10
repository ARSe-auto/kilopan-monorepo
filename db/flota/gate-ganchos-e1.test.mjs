#!/usr/bin/env node
// Mutantes del gate de ganchos §4.9 [AC-FVEH-14].
//
// Un gate que solo se prueba contra el repo sano es un gate del que nadie sabe si dispara. Acá
// se plantan los dos defectos que existe para atrapar —una pantalla de un gancho DDL-only y una
// segunda implementación de telemetría— en un SANDBOX, nunca en el árbol real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SIN_PANTALLA, FUENTES_DE_E4, CONFIANZAS_DE_E2, sinComentarios } from "./gate-ganchos-e1.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const GATE = join(RAIZ, "db/flota/gate-ganchos-e1.mjs");

function sandbox(archivos = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-ganchos-"));
  mkdirSync(join(raiz, "apps/flota/src/app"), { recursive: true });
  // Un archivo de UI sano, para que el gate no se declare vacuo por falta de árbol.
  writeFileSync(join(raiz, "apps/flota/src/app/.fixture-sana.tsx"), "export const x = 1;\n");
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
    assert.match(execFileSync("node", [GATE], { encoding: "utf8" }), /gate-ganchos-e1: VERDE/);
  } catch (e) {
    assert.fail(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});

test("cada gancho DDL-only dispara si aparece en una pantalla", () => {
  // El nombre se ARMA desde la lista: escrito literal, este archivo tendría que actualizarse a
  // mano cada vez que el §4.9 sume un gancho, y el que falte quedaría sin vigilancia.
  for (const tabla of SIN_PANTALLA) {
    const raiz = sandbox({
      "apps/flota/src/app/.fixture-pantalla.tsx": `const filas = await pedir("/api/${tabla}");\n`,
    });
    const { codigo, salida } = correr(raiz);
    assert.equal(codigo, 1, `${tabla} no disparó`);
    assert.match(salida, new RegExp(tabla));
  }
});

test("cada fuente de E4 dispara si alguien la escribe como cadena", () => {
  for (const fuente of FUENTES_DE_E4) {
    const raiz = sandbox({
      "apps/flota/src/.fixture-telemetria.ts": `export const fuente = "${fuente}";\n`,
    });
    assert.equal(correr(raiz).codigo, 1, `${fuente} no disparó`);
  }
});

test("cada confianza de geocoding de E2 dispara si alguien la escribe como cadena", () => {
  // El geocoding es E2 (§3.E2). Escribir `rooftop` en E1 sería afirmar que una coordenada cayó
  // sobre el techo del local cuando en realidad la tecleó una persona — y de esa afirmación
  // cuelga que una parada se planifique sin que nadie confirme el pin.
  for (const confianza of CONFIANZAS_DE_E2) {
    const raiz = sandbox({
      "apps/flota/src/.fixture-geo.ts": `export const confianza = "${confianza}";\n`,
    });
    assert.equal(correr(raiz).codigo, 1, `${confianza} no disparó`);
  }
});

test("las confianzas que E1 SÍ produce no disparan", () => {
  // La otra mitad: sin ella, el guard haría imposible escribir el valor que el módulo necesita
  // todos los días y alguien lo apagaría en una semana.
  const raiz = sandbox({
    "apps/flota/src/.fixture-geo-ok.ts": 'export const a = "manual"; export const b = "sin_geo";\n',
  });
  assert.equal(correr(raiz).codigo, 0);
});

test("nombrar un gancho en un COMENTARIO no dispara", () => {
  // Explicar por qué algo NO está es exactamente lo que hay que hacer en un módulo que deja
  // ganchos apagados. Un guard que castiga documentar se apaga solo a la semana.
  const raiz = sandbox({
    "apps/flota/src/app/.fixture-doc.tsx": "// la UI de excursion es de E3 (§3-FUERA)\nexport const x = 1;\n",
    "apps/flota/src/.fixture-doc.ts": "/* la fuente obd llega en E4 */\nexport const y = 2;\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("la fuente `declarada` NO dispara: es la única que E1 admite", () => {
  const raiz = sandbox({
    "apps/flota/src/.fixture-declarada.ts": 'export const fuente = "declarada";\n',
  });
  assert.equal(correr(raiz).codigo, 0);
});

test("sin árbol de pantallas el gate lo DICE en vez de pasar en silencio", () => {
  const raiz = mkdtempSync(join(tmpdir(), "flota-ganchos-vacio-"));
  const { salida } = correr(raiz);
  assert.match(salida, /SIN ÁRBOL DE PANTALLAS/);
});

test("los comentarios se vacían sin correr los números de línea", () => {
  const texto = "uno\n/* dos\n   tres */\ncuatro // cinco\n";
  const limpio = sinComentarios(texto);
  assert.equal(limpio.split("\n").length, texto.split("\n").length);
  assert.equal(limpio.split("\n")[3].trim(), "cuatro");
});
