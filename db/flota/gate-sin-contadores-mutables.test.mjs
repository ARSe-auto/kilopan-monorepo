import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mutacionesEn, sinComentarios, COLUMNAS_VISIBLES } from "./gate-sin-contadores-mutables.mjs";

// Mutantes del gate que prohíbe mutar el estado visible de `paradas` a mano [AC-FPOD-21] —
// §4.6, §2: «el estado visible es proyección, jamás contadores mutables».

test("un UPDATE que fija `estado` se detecta", () => {
  const codigo = `await c.query("update paradas set estado = 'done' where id = $1", [id]);`;
  assert.deepEqual(mutacionesEn(codigo), [{ linea: 1, columna: "estado" }]);
});

test("un UPDATE que fija `resultado` se detecta", () => {
  const codigo = `await c.query(\n  "update paradas set resultado = $2 where id = $1",\n  [id, r],\n);`;
  const hallazgos = mutacionesEn(codigo);
  assert.equal(hallazgos.length, 1);
  assert.equal(hallazgos[0].columna, "resultado");
});

test("las dos columnas en la MISMA sentencia se reportan las dos", () => {
  const codigo = "update paradas set estado = 'done', resultado = 'exito' where id = $1";
  const hallazgos = mutacionesEn(codigo);
  assert.deepEqual(
    hallazgos.map((h) => h.columna).sort(),
    ["estado", "resultado"],
  );
});

test("mayúsculas/minúsculas no protegen al UPDATE", () => {
  assert.equal(mutacionesEn("UPDATE paradas SET estado = 'done' WHERE id = $1").length, 1);
});

// ─── Los gemelos: lo que NO puede rebotar ────────────────────────────────────────────

test("un UPDATE de paradas que NO toca las columnas visibles no rebota (orden, ventana, promesa)", () => {
  assert.deepEqual(mutacionesEn("update paradas set orden = orden + 10000 where ruta_id = $1"), []);
  assert.deepEqual(
    mutacionesEn("update paradas set promesa_original = ventana where ruta_id = $1 and ventana is not null"),
    [],
  );
});

test("mencionar la columna en el WHERE de la misma sentencia no es mutarla", () => {
  assert.deepEqual(
    mutacionesEn("update paradas set orden = $2 where id = $1 and resultado is null"),
    [],
  );
});

test("un UPDATE de OTRA tabla que también tenga una columna `estado` no rebota", () => {
  assert.deepEqual(mutacionesEn("update review_queue set estado = 'reconocida' where id = $1"), []);
});

test("nombrar el UPDATE prohibido en un comentario, para explicar por qué no está, es legítimo", () => {
  assert.deepEqual(
    mutacionesEn("// jamás: update paradas set estado = 'done' — es proyección (AC-FPOD-21)"),
    [],
  );
  assert.deepEqual(
    mutacionesEn("/* update paradas set resultado = 'exito' — prohibido */\nconst x = 1;"),
    [],
  );
});

test("una SELECT que lee `estado`/`resultado` no es una mutación", () => {
  assert.deepEqual(mutacionesEn("select estado, resultado from paradas where id = $1"), []);
});

// ─── El positivo, que impide el verde vacuo ─────────────────────────────────────────

test("las dos columnas visibles siguen declaradas en la 0037", () => {
  const ddl = readFileSync(
    new URL("../../db/migraciones-flota/tenant/0037_rutas_paradas_e_items.sql", import.meta.url),
    "utf8",
  );
  for (const columna of COLUMNAS_VISIBLES) {
    assert.match(
      ddl,
      new RegExp(`\\b${columna}\\s+parada_(estado|resultado)\\b`),
      `la 0037 dejó de declarar paradas.${columna}`,
    );
  }
});

test("`sinComentarios` conserva el número de líneas", () => {
  const texto = "uno\n/* dos\ntres */\ncuatro";
  assert.equal(sinComentarios(texto).split("\n").length, texto.split("\n").length);
});
