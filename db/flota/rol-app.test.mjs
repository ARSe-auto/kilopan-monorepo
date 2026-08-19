#!/usr/bin/env node
// Mutantes de la clave y del nombre del rol de app [AC-FTEN-03].
//
// `CREATE ROLE … PASSWORD` no admite parámetro de consulta: la clave va INTERPOLADA en un
// DDL que crea credenciales. Que la única puerta por la que pasa sea estrecha se prueba acá,
// sin cluster; el rechazo de Postgres a las credenciales cruzadas está en
// `db/flota/suite-bd/rol-app.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveNueva, claveCitable } from "./rol-app.mjs";
import { rolDeTenant, bdDeTenant } from "./conectar.mjs";

test("[AC-FTEN-03] `claveNueva` produce claves citables y distintas entre sí", () => {
  const claves = new Set(Array.from({ length: 50 }, claveNueva));
  assert.equal(claves.size, 50, "dos altas de tenant salieron con la misma clave");
  for (const c of claves) assert.equal(claveCitable(c), c);
});

test("[AC-FTEN-03] `claveNueva` no es corta: 24 bytes de azar, no un número de serie", () => {
  assert.ok(claveNueva().length >= 32, "la clave quedó por debajo de 24 bytes de entropía");
});

for (const [nombre, mala] of [
  ["comilla simple", "abcdefghijklmnop'; drop role app_t_a --"],
  ["barra invertida", "abcdefghijklmnop\\x27"],
  ["espacio", "abcdefghijklmnop qrst"],
  ["demasiado corta", "abc"],
  ["vacía", ""],
]) {
  test(`[AC-FTEN-03] una clave con ${nombre} no llega nunca al DDL`, () => {
    assert.throws(() => claveCitable(mala), /no puedo poner en un DDL/);
  });
}

test("[AC-FTEN-03] el rol de un tenant se llama `app_t_<slug>` y sale del mismo lugar que su BD", () => {
  assert.equal(rolDeTenant("gate_a"), "app_t_gate_a");
  assert.equal(rolDeTenant("gate_a"), `app_${bdDeTenant("gate_a")}`);
});

test("[AC-FTEN-03] un slug que no serviría como nombre de base tampoco produce rol", () => {
  // El nombre del rol se interpola en un DDL igual que el de la base: una sola validación
  // para los dos, o el rol sería la puerta que la base ya cerró.
  assert.throws(() => rolDeTenant("Gate-A"), /slug inválido/);
  assert.throws(() => rolDeTenant("1tenant"), /slug inválido/);
});
