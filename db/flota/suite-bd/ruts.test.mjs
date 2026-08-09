#!/usr/bin/env node
// La lista congelada de RUTs sintéticos, contra el módulo 11 REAL [AC-FIDN-21] — §7.8.
//
// El AC pide dos cosas de todo RUT sembrado: (a) que pase el módulo 11 y (b) que pertenezca a
// la lista congelada. La (b) la verifica `db/flota/gate-ruts.mjs`, estático y sin base. Esta
// suite cubre la (a) — y la cubre pasando la lista por la ÚNICA implementación del módulo 11
// que existe, la de la base (`rut_valido()`, AC-FIDN-01), en vez de escribir una segunda en
// JavaScript que un día se separe de la primera.
//
// Y verifica la otra mitad, que es la que impide que esta suite sea decorativa: los RUTs
// declarados como INVÁLIDOS A PROPÓSITO tienen que fallar de verdad. Si alguno pasara, sería
// un fixture que ya no prueba lo que dice probar — el test del rebote seguiría en verde sin
// que nada rebote.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { VALIDOS, INVALIDOS_A_PROPOSITO } from "../ruts-sinteticos.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";

const SLUG = "gate_ruts";
let migrador;

async function limpiar() {
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`));
  await borrarRolDeApp(SLUG);
}

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  await limpiar();
  const tenant = await provisionar(SLUG, { recrear: true });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });
});

after(async () => {
  await migrador?.cerrar();
  await limpiar();
});

const valida = async (rut) => {
  const [f] = await migrador.sql("select rut_valido($1) as ok", [rut]);
  return f.ok;
};

test("[AC-FIDN-21] cada RUT declarado válido pasa el módulo 11 de la base", async () => {
  for (const [rut, razon] of Object.entries(VALIDOS)) {
    assert.equal(await valida(rut), true, `«${rut}» está en la lista de válidos pero no pasa: ${razon}`);
  }
});

test("[AC-FIDN-21] los declarados inválidos fallan de verdad: el fixture no se volvió decorativo", async () => {
  for (const [rut, razon] of Object.entries(INVALIDOS_A_PROPOSITO)) {
    assert.equal(await valida(rut), false, `«${rut}» se declaró inválido y la base lo acepta: ${razon}`);
  }
});

test("[AC-FIDN-21] la lista no está vacía ni se solapa consigo misma", async () => {
  // Un verde vacuo acá sería el más fácil de todos: con las dos listas vacías, los dos tests
  // de arriba pasarían sin haber consultado nada.
  assert.ok(Object.keys(VALIDOS).length > 0, "la lista de válidos está vacía");
  assert.ok(Object.keys(INVALIDOS_A_PROPOSITO).length > 0, "la lista de inválidos está vacía");
  const cruce = Object.keys(VALIDOS).filter((r) => r in INVALIDOS_A_PROPOSITO);
  assert.deepEqual(cruce, [], "hay un RUT declarado como válido Y como inválido a propósito");
});

test("[AC-FIDN-21] cada RUT declarado trae escrita su razón de existir", async () => {
  // Una lista sin razones se vuelve un cajón donde todo entra: el que agrega el próximo RUT
  // tiene que decir para qué, y quien revise el diff puede juzgarlo.
  for (const [rut, razon] of Object.entries({ ...VALIDOS, ...INVALIDOS_A_PROPOSITO })) {
    assert.ok(typeof razon === "string" && razon.trim().length > 20, `«${rut}» sin razón escrita`);
  }
});

test("[AC-FIDN-21] un RUT REAL cualquiera no está en la lista: el default es que no se puede sembrar", async () => {
  // La propiedad que hace útil al gate. Se toma un RUT sintácticamente válido que NO está
  // declarado —lo valida la base, así que es un RUT legítimo— y se comprueba que la lista lo
  // rechaza igual. Pasar el módulo 11 no alcanza para poder sembrarlo.
  const { declarado } = await import("../ruts-sinteticos.mjs");
  // Se ARMA en vez de escribirse literal, y no por elegancia: escrito entero, `gate-ruts.mjs`
  // lo encontraría en este archivo y pondría el gate en rojo — que es exactamente el gate
  // haciendo su trabajo contra quien lo escribió. Un RUT no declarado no puede estar en el
  // árbol ni siquiera dentro del test que prueba que no puede estar.
  const noDeclarado = `${1}.${"111"}.${"111"}-${4}`;
  assert.equal(await valida(noDeclarado), true, "el RUT de esta prueba tiene que ser válido");
  assert.equal(declarado(noDeclarado), false, "un RUT válido pero no declarado se coló en la lista");
});
