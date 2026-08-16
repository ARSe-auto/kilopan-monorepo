import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GANCHOS, siembrasEn, sinComentarios, DONDE_VIVE } from "./gate-seeds-alarm-thermal.mjs";

// Mutantes del chequeo de siembra de `thermal_profile`/`alarm_rule` [AC-FMIG-15] — §4.9,
// §2 métrica 4.
//
// Un gate que nunca se pone rojo es peor que no tenerlo. Cada caso de acá es una forma REAL en
// que alguien sembraría el gancho por accidente, y su gemelo es una forma legítima de nombrarlo
// que NO puede rebotar.

test("una siembra de thermal_profile en SQL se detecta", () => {
  const sql = `insert into thermal_profile (codigo, min_centesimas, max_centesimas)
               values ('frio_estandar', -500, 500);`;
  const ofensas = siembrasEn(sql);
  assert.equal(ofensas.length, 1);
  assert.equal(ofensas[0].linea, 1);
  assert.equal(ofensas[0].gancho, "thermal_profile");
});

test("una siembra de alarm_rule en un fixture de JavaScript se detecta", () => {
  const js = `await c.sql("insert into alarm_rule (thermal_profile_id, tipo, activa) " +
                "values ($1, 'instantanea', true)", [perfilId]);`;
  const ofensas = siembrasEn(js);
  assert.equal(ofensas.length, 1);
  assert.equal(ofensas[0].gancho, "alarm_rule");
});

test("mayúsculas/minúsculas no esconden el INSERT", () => {
  assert.equal(siembrasEn("INSERT INTO alarm_rule (tipo) values ('instantanea');").length, 1);
});

// ─── Los gemelos: lo que NO puede rebotar ────────────────────────────────────────────

test("nombrar el gancho en un comentario SQL para explicar por qué NO está es legítimo", () => {
  const sql = `-- ningún seed E1 hace insert into thermal_profile (§4.9)
               insert into cargo_type (codigo, nombre) values ('pan', 'Pan de molde');`;
  assert.deepEqual(siembrasEn(sql), []);
});

test("nombrar el gancho en un comentario de JavaScript tampoco rebota", () => {
  assert.deepEqual(
    siembrasEn(`// en E1 nadie hace insert into alarm_rule (§4.9, §2 métrica 4)`),
    [],
  );
});

test("ni dentro de un bloque /* */, que es donde va la explicación larga", () => {
  const js = `/* Acá NO se hace insert into thermal_profile:
                 es DDL-only en E1. */
              const meta = 18;`;
  assert.deepEqual(siembrasEn(js), []);
});

test("un SELECT sobre la tabla no es sembrarla", () => {
  assert.deepEqual(siembrasEn("select id from thermal_profile where codigo = 'x';"), []);
});

test("declarar la tabla con CREATE TABLE no es sembrarla", () => {
  assert.deepEqual(siembrasEn("create table alarm_rule (id uuid not null);"), []);
});

// ─── El positivo, que impide el verde vacuo ─────────────────────────────────────────

test("las dos tablas tienen que seguir declaradas en el DDL", () => {
  const ddl = new URL(`../../${DONDE_VIVE}`, import.meta.url);
  const texto = readFileSync(ddl, "utf8");
  for (const gancho of GANCHOS) {
    assert.match(
      texto,
      new RegExp(String.raw`create\s+table\s+${gancho}\b`, "i"),
      `${DONDE_VIVE} dejó de declarar «${gancho}»`,
    );
  }
});

test("`sinComentarios` conserva el número de líneas", () => {
  const texto = "uno\n/* dos\ntres */\ncuatro";
  assert.equal(sinComentarios(texto).split("\n").length, texto.split("\n").length);
});
