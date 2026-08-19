#!/usr/bin/env node
// Mutantes del gate de ganchos §4.9 [AC-FVEH-14, AC-FTEL-06].
//
// Un gate que solo se prueba contra el repo sano es un gate del que nadie sabe si dispara. Acá
// se plantan los defectos que existe para atrapar —una pantalla de un gancho DDL-only y una
// implementación de telemetría FUERA del registro de E1.5— en un SANDBOX, nunca en el árbol
// real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SIN_PANTALLA,
  FUENTES_DE_E4,
  FUENTES_DEL_REGISTRO,
  CONFIANZAS_DE_E2,
  sinComentarios,
} from "./gate-ganchos-e1.mjs";

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

test("[AC-FTEL-06] las fuentes DEL REGISTRO no disparan: son implementaciones reales, no E4", () => {
  // El nombre se ARMA desde la lista, no se escribe literal: con `declarada` y `telefono_gps`
  // hardcodeadas acá, la implementación que el §11 sume mañana quedaría sin este positivo y
  // nadie notaría que el gate la está mordiendo.
  for (const fuente of FUENTES_DEL_REGISTRO) {
    const raiz = sandbox({
      "apps/flota/src/.fixture-registro.ts": `export const fuente = "${fuente}";\n`,
    });
    assert.equal(correr(raiz).codigo, 0, `«${fuente}» disparó y está en el registro`);
  }
});

test("[AC-FTEL-06] el registro y las fuentes de E4 no se solapan", () => {
  // La frontera entre «implementación real de E1.5» y «E4 entrando por la puerta de atrás»
  // deja de separar nada el día que la misma fuente aparece en las dos listas.
  assert.ok(FUENTES_DEL_REGISTRO.length > 0, "el registro vacío haría vacuo este test");
  for (const fuente of FUENTES_DEL_REGISTRO) {
    assert.equal(FUENTES_DE_E4.includes(fuente), false, `«${fuente}» está en las dos listas`);
  }
});

test("[AC-FTEL-07] el header HTTP Content-Disposition no dispara la tabla `disposition`", () => {
  // El export de PODs por rango descarga un CSV y necesita el header estándar de descarga —no
  // tiene nada que ver con la tabla DDL-only `disposition` (§4.9), pero comparte la palabra en
  // inglés. Sin esta excepción, CUALQUIER descarga de archivo en el árbol de pantallas
  // dispararía el gate en falso.
  const raiz = sandbox({
    "apps/flota/src/app/api/.fixture-descarga.ts":
      'return new Response(csv, { headers: { "content-disposition": `attachment; filename="x.csv"` } });\n',
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("[AC-FTEL-07] pero una referencia REAL a la tabla `disposition` sigue disparando", () => {
  // El gemelo del test anterior: sin él, «el header no dispara» lo cumpliría un gate que dejó
  // de mirar la tabla por completo.
  const raiz = sandbox({
    "apps/flota/src/app/api/.fixture-fuga.ts": "const filas = await pedir(`select * from disposition`);\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1, salida);
  assert.match(salida, /disposition/);
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

// ─── Miembro de unión ≠ fuente de telemetría [11-ago-2026] ──────────────────────────
//
// `archivo_logger` vive en DOS enums: es una fuente de `reading` —E4, prohibida en E1— y también
// un tipo de `evidencia` (§4.6), que existe en el DDL desde el día 1 y que el POD necesita
// nombrar para saber qué evidencia pedir. El gate los confundía y marcaba la lista de tipos de
// evidencia como telemetría de E4: frenó al motor con un AC ya terminado y sus tests en verde.
//
// La marca que los separa es sintáctica y no ambigua: un miembro de unión de TypeScript es una
// línea que empieza con `|` y no tiene nada más.

test("un miembro de unión de tipos NO es una fuente de telemetría", () => {
  const union = `export type TipoDeEvidencia =
  | "firma"
  | "foto"
  | "archivo_logger"
  | "documento";`;
  assert.equal(sinComentarios(union).includes("archivo_logger"), true, "el fixture perdió el valor");
  // Lo que se ejerce es el filtro del gate, no el `includes` de arriba: la línea de unión se
  // descarta antes de buscar la fuente.
  const vivas = sinComentarios(union)
    .split("\n")
    .filter((l) => !/^\s*\|\s*['"`][a-z_]+['"`]\s*,?\s*$/.test(l))
    .join("\n");
  assert.equal(/['"`]archivo_logger['"`]/.test(vivas), false, "el miembro de unión se leyó como fuente");
});

test("y una fuente DE VERDAD sigue cayendo, que es el punto del gate", () => {
  // Sin este gemelo, «no muerde las uniones» lo cumpliría un gate que no mira nada.
  const real = `const fuente = "archivo_logger";
await c.query("insert into reading (fuente) values ($1)", [fuente]);`;
  const vivas = real
    .split("\n")
    .filter((l) => !/^\s*\|\s*['"`][a-z_]+['"`]\s*,?\s*$/.test(l))
    .join("\n");
  assert.equal(/['"`]archivo_logger['"`]/.test(vivas), true, "una fuente real dejó de detectarse");
});
