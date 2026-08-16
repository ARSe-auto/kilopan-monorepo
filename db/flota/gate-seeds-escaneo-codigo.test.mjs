import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GANCHO, siembrasEn, sinComentarios, DONDE_VIVE } from "./gate-seeds-escaneo-codigo.mjs";

// Mutantes del chequeo de seeds del gancho `escaneo_codigo` [AC-FPOD-17] — §4.9, §5.2 F4, §3.E3.
//
// Un gate que nunca se pone rojo es peor que no tenerlo: da la sensación de estar cuidado. Cada
// caso de acá es una forma REAL en que el gancho podría sembrarse, y su gemelo es una forma
// legítima de nombrarlo que NO puede rebotar — porque un gate que muerde al documentar enseña a
// dejar de documentar. Mismos mutantes que `gate-seeds-pin-destinatario.test.mjs` (AC-FRUT-20),
// contra el gancho hermano del mismo enum.

test("una siembra en SQL se detecta", () => {
  const sql = `insert into cargo_type_requirement (cargo_type_id, tipo_evidencia, orden)
               values ($1, 'escaneo_codigo', 3);`;
  assert.deepEqual(siembrasEn(sql), [2]);
});

test("una siembra en un fixture de JavaScript se detecta", () => {
  const js = `await c.sql("insert into stop_requirement (parada_id, tipo_evidencia, orden) " +
                "values ($1, 'escaneo_codigo', 1)", [paradaId]);`;
  assert.equal(siembrasEn(js).length, 1);
});

test("con comillas dobles también, que es como se escribe en JavaScript", () => {
  assert.equal(siembrasEn(`const tipo = "escaneo_codigo";`).length, 1);
});

test("y con acento grave, que es como entra en un template de consulta", () => {
  assert.equal(siembrasEn("const tipo = `escaneo_codigo`;").length, 1);
});

// ─── Los gemelos: lo que NO puede rebotar ────────────────────────────────────────────

test("nombrarlo en un comentario SQL para explicar por qué NO está es legítimo", () => {
  const sql = `-- El tipo 'escaneo_codigo' existe en el enum y ningún seed E1 lo siembra.
               insert into cargo_type_requirement values ($1, 'firma', 1);`;
  assert.deepEqual(siembrasEn(sql), []);
});

test("nombrarlo en un comentario de JavaScript tampoco rebota", () => {
  assert.deepEqual(siembrasEn(`// en E1 nadie siembra 'escaneo_codigo' (§5.2 F4)`), []);
});

test("ni dentro de un bloque /* */, que es donde va la explicación larga", () => {
  const js = `/* El gancho 'escaneo_codigo' es de E3.
                 Acá no se siembra. */
              const tipo = "firma";`;
  assert.deepEqual(siembrasEn(js), []);
});

test("mencionarlo SIN comillas no es sembrarlo: es hablar de él", () => {
  // El nombre suelto aparece en prosa, en títulos de sección y en mensajes de commit. Lo que
  // siembra una fila es la CADENA, porque una columna de enum se escribe entre comillas.
  assert.deepEqual(siembrasEn("El gancho escaneo_codigo queda para E3."), []);
});

// ─── El positivo, que impide el verde vacuo ─────────────────────────────────────────

test("el gancho tiene que seguir declarado en el enum del DDL", () => {
  // «Nadie lo siembra» lo cumpliría también un repo donde el valor no existe, y ese es el error
  // OPUESTO: el §4.9 lo quiere vivo para que encenderlo en E3 sean filas y no una migración.
  const ddl = new URL(`../../${DONDE_VIVE}`, import.meta.url);
  assert.match(
    readFileSync(ddl, "utf8"),
    new RegExp(`['"]${GANCHO}['"]`),
    "el enum de evidencia dejó de declarar el gancho",
  );
});

test("`sinComentarios` conserva el número de líneas", () => {
  // Si las colapsara, el número de línea que el gate reporta apuntaría a otro lado y quien lo
  // reciba buscaría el problema donde no está.
  const texto = "uno\n/* dos\ntres */\ncuatro";
  assert.equal(sinComentarios(texto).split("\n").length, texto.split("\n").length);
});
