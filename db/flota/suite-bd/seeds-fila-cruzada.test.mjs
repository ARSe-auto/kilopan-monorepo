#!/usr/bin/env node
// El caso de rebote de AC-FMIG-18: «una fila cruzada entre tenants ⇒ rojo» (§10, §9.3.2).
//
// specs/flota/08-diseno-miga-onboarding.md §7: los seeds llevan «cadenas centinela ÚNICAS por
// tenant» y el §9.3.2 (centinela 2) exige que el caso de cruce NO se conforme con un 404 del
// lado HTTP: hay que mirar la HUELLA de la BD del vecino. Un 404 dice que la ruta no sirvió el
// dato; solo la huella dice que el dato no ESTÁ.
//
// ─── QUÉ VERIFICA, Y POR QUÉ EN ESE ORDEN ────────────────────────────────────────────
//
// (1) Control POSITIVO: cada tenant lleva su propio centinela en su base. Sin esto, «no hay
//     cruce» podría significar «el barrido no encuentra nada nunca», y el rojo del caso de
//     rebote no llegaría jamás.
// (2) La propiedad: el centinela de B no aparece en la base de C, ni el de C en la de B.
// (3) El MUTANTE: se planta a mano una fila de C con el centinela de B —exactamente la fila
//     cruzada que el AC nombra— y se verifica que el barrido se pone ROJO. Después se la
//     retira y se verifica que vuelve a verde. Sin este paso, (2) sería verde aunque el
//     barrido estuviera mirando la base equivocada o una lista vacía de columnas.
//
// El barrido cubre las columnas de TEXTO de todas las tablas de `public` (`huellaDeCentinela`,
// seeds/comun.mjs), descubiertas del catálogo y no de una lista escrita a mano: una lista
// curada se queda vieja el día que alguien agrega una tabla, y nada avisa.
//
// El e2e HTTP del camino dorado A/B/C que el texto del §10 también pide sigue pendiente
// (AC-FMIG-27); este es su mitad de BD, que es la que el §9.3.2 llama insustituible.
//
// EXTENSIÓN A TENANT A [AC-FMIG-25]: el barrido nació con B y C porque el tenant A no existía.
// Ahora existe y entra al mismo barrido, con las MISMAS tres partes: control positivo, propiedad
// (cero cruces A×B y A×C) y una fila de A plantada a mano en la base de B que lo pone ROJO.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con } from "../conectar.mjs";
import { huellaDeCentinela } from "../seeds/comun.mjs";
import { sembrarTenantA, CENTINELA_A } from "../seeds/tenant-a.mjs";
import { sembrarTenantB, CENTINELA_B } from "../seeds/tenant-b.mjs";
import { sembrarTenantC, CENTINELA_C } from "../seeds/tenant-c.mjs";

const SLUG_A = "gate_cruce_a";
const SLUG_B = "gate_cruce_b";
const SLUG_C = "gate_cruce_c";

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
});

const enQue = (huella) => huella.map((h) => `${h.tabla}.${h.columna}×${h.filas}`).join(", ");

test("[AC-FMIG-18] seeds B y C: cero filas cruzadas, y una fila cruzada plantada a mano ⇒ ROJO", async () => {
  const b = await sembrarTenantB(SLUG_B, { recrear: true });
  const c = await sembrarTenantC(SLUG_C, { recrear: true });

  // (1) Control positivo: el barrido SÍ encuentra lo que tiene que encontrar.
  const propiaB = await huellaDeCentinela(b.bd, CENTINELA_B);
  const propiaC = await huellaDeCentinela(c.bd, CENTINELA_C);
  assert.ok(propiaB.length > 0, `el centinela de B no aparece en su propia base ${b.bd}`);
  assert.ok(propiaC.length > 0, `el centinela de C no aparece en su propia base ${c.bd}`);

  // (2) La propiedad: ninguna fila de un tenant vive en la base del otro.
  const cruceEnC = await huellaDeCentinela(c.bd, CENTINELA_B);
  const cruceEnB = await huellaDeCentinela(b.bd, CENTINELA_C);
  assert.deepEqual(cruceEnC, [], `el centinela de B apareció en ${c.bd}: ${enQue(cruceEnC)}`);
  assert.deepEqual(cruceEnB, [], `el centinela de C apareció en ${b.bd}: ${enQue(cruceEnB)}`);

  // (3) El mutante: la fila cruzada del AC, plantada a mano en la base de C con el centinela de
  // B. `destinos` es la tabla más inocente que hay —solo un nombre— y por eso mismo sirve: si
  // el barrido no la ve, tampoco vería un cruce en una tabla de dinero.
  const [plantada] = await con(c.bd, ({ sql }) =>
    sql("insert into destinos (nombre) values ($1) returning id::text as id", [
      `Destino que se coló del tenant vecino ${CENTINELA_B}`,
    ]),
  );
  try {
    const conCruce = await huellaDeCentinela(c.bd, CENTINELA_B);
    assert.ok(
      conCruce.length > 0,
      "el barrido de huella NO vio la fila cruzada plantada a mano: el caso de rebote del AC " +
        "sería verde con datos de otro tenant adentro",
    );
    assert.ok(
      conCruce.some((h) => h.tabla === "destinos" && h.columna === "nombre"),
      `el barrido vio un cruce, pero no el que se plantó: ${enQue(conCruce)}`,
    );
  } finally {
    await con(c.bd, ({ sql }) => sql("delete from destinos where id = $1", [plantada.id]));
  }

  // Y al retirarla, vuelve a verde: el rojo de arriba fue por la fila, no por el barrido.
  const despues = await huellaDeCentinela(c.bd, CENTINELA_B);
  assert.deepEqual(despues, [], `quedó rastro del cruce tras retirar la fila: ${enQue(despues)}`);
});

test("[AC-FMIG-25] el barrido extendido a A: cero cruces A×B y A×C, y una fila de A en la base de B ⇒ ROJO", async () => {
  const a = await sembrarTenantA(SLUG_A, { recrear: true });
  const b = await sembrarTenantB(SLUG_B, { recrear: true });
  const c = await sembrarTenantC(SLUG_C, { recrear: true });

  // (1) Control positivo: el centinela de A aparece en su propia base y en más de una columna —
  // el tenant A es el grande del §10 y su huella tiene que verse en las personas, las empresas y
  // los destinos, no en un solo lugar por casualidad.
  const propiaA = await huellaDeCentinela(a.bd, CENTINELA_A);
  assert.ok(propiaA.length > 0, `el centinela de A no aparece en su propia base ${a.bd}`);
  assert.ok(
    propiaA.some((h) => h.tabla === "empresas_cliente") && propiaA.some((h) => h.tabla === "destinos"),
    `la huella de A es demasiado flaca para servir de control: ${enQue(propiaA)}`,
  );

  // (2) La propiedad, en las cuatro direcciones que A agrega.
  const cruces = [
    ["A en la base de B", await huellaDeCentinela(b.bd, CENTINELA_A)],
    ["A en la base de C", await huellaDeCentinela(c.bd, CENTINELA_A)],
    ["B en la base de A", await huellaDeCentinela(a.bd, CENTINELA_B)],
    ["C en la base de A", await huellaDeCentinela(a.bd, CENTINELA_C)],
  ];
  for (const [que, huella] of cruces) {
    assert.deepEqual(huella, [], `${que}: ${enQue(huella)}`);
  }

  // (3) El mutante del texto del AC: una fila de A plantada a mano en la base de B.
  const [plantada] = await con(b.bd, ({ sql }) =>
    sql("insert into destinos (nombre) values ($1) returning id::text as id", [
      `Destino que se coló del tenant e-auto ${CENTINELA_A}`,
    ]),
  );
  try {
    const conCruce = await huellaDeCentinela(b.bd, CENTINELA_A);
    assert.ok(
      conCruce.some((h) => h.tabla === "destinos" && h.columna === "nombre"),
      "el barrido de huella NO vio la fila de A plantada en la base de B: el caso de rebote del " +
        `AC sería verde con datos del tenant vecino adentro (vio: ${enQue(conCruce)})`,
    );
  } finally {
    await con(b.bd, ({ sql }) => sql("delete from destinos where id = $1", [plantada.id]));
  }

  const despues = await huellaDeCentinela(b.bd, CENTINELA_A);
  assert.deepEqual(despues, [], `quedó rastro del cruce tras retirar la fila: ${enQue(despues)}`);
});
