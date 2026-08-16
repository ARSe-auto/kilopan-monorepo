#!/usr/bin/env node
// Export ARCO por persona, contra el cluster real [AC-FIDN-15] — §3.E1.15, §7.8, Ley 21.719.
//
// Lo que se prueba acá y no en `dominio/arco.test.ts`: la PRIMERA capa. Las consultas del
// export llevan la lista blanca escrita en el SELECT, y afirmar que «`secreto_hash` no sale»
// contra una fila inventada en memoria no prueba nada — el hash tiene que existir en la base,
// en la fila de la titular, y aun así no aparecer. Eso pide una base con datos adentro.
//
// El fixture es adversarial a propósito: la persona A tiene un aparato que enroló un usuario
// de B (`enrolado_por`, dato de un tercero viviendo en una fila de A), y el tenant tiene un
// aparato de ANDÉN sin dueña. Los dos son las formas en que «filtrar por persona_id» se queda
// corto, y los dos tienen que quedar afuera del documento de A.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { migrar } from "../migrar.mjs";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import {
  armarExportArco,
  camposVedadosEn,
  CAMPOS_VEDADOS,
  SQL_TITULAR,
  SQL_USUARIOS,
  SQL_DISPOSITIVOS,
} from "../../../apps/flota/src/dominio/arco.ts";

const SLUG = "gate_arco";

/** RUTs sintácticamente válidos e IRREALES (§7.8: cero datos personales reales en seeds). */
const RUT_A = "18.777.333-4";
const RUT_B = "19.888.444-8";

const NOMBRE_A = "Titular Arco";
const NOMBRE_B = "Tercero Arco";
const CONTACTO_A = "+56911110000";
const CONTACTO_B = "+56922220000";
const PIN_HASH_A = "$argon2id$fixture$titular";
const SECRETO_HASH_A = "$argon2id$fixture$aparato-de-la-titular";

let app;
let migrador;
let personaA;
let personaB;

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
  await migrar();
  await limpiar();
  const tenant = await provisionar(SLUG, { recrear: true });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });

  [personaA] = await app.sql(
    "insert into personas (rut, nombre, contacto) values ($1, $2, $3) returning id::text as id",
    [RUT_A, NOMBRE_A, CONTACTO_A],
  );
  [personaB] = await app.sql(
    "insert into personas (rut, nombre, contacto) values ($1, $2, $3) returning id::text as id",
    [RUT_B, NOMBRE_B, CONTACTO_B],
  );

  await app.sql("insert into usuarios (persona_id, rol, pin_hash) values ($1, 'chofer', $2)", [
    personaA.id,
    PIN_HASH_A,
  ]);
  const [usuarioB] = await app.sql(
    "insert into usuarios (persona_id, rol, pin_hash) values ($1, 'admin_tenant', $2) returning id::text as id",
    [personaB.id, "$argon2id$fixture$tercero"],
  );

  // El aparato de A lo enroló un usuario de B: el dato de tercero que vive en la fila propia.
  await app.sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('personal', $1, $2, $3, now())`,
    [personaA.id, SECRETO_HASH_A, usuarioB.id],
  );
  await app.sql(
    "insert into dispositivos (tipo, persona_id, secreto_hash) values ('personal', $1, $2)",
    [personaB.id, "$argon2id$fixture$aparato-del-tercero"],
  );
  // El andén: activo del TENANT, sin persona dueña (§4.3, F-D).
  await app.sql("insert into dispositivos (tipo, secreto_hash) values ('anden', $1)", [
    "$argon2id$fixture$anden",
  ]);
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

// ─── El catálogo, que es lo que desbloquea la bitácora del §3.E1.15 ───────────────────

test("[AC-FIDN-15] `gobierno.arco_exportado` está sembrado y cae bajo el filtro de la bitácora", async () => {
  const [tipo] = await app.sql("select id::text as id, codigo from evento_tipo where codigo = $1", [
    "gobierno.arco_exportado",
  ]);
  assert.ok(tipo, "sin este código, `registrarEvento` deshace el acto entero y no hay export posible");
  // `auditoriaDeAccesos` (AC-FIDN-12) lee SOLO los `gobierno.%`: un código con otro prefijo
  // dejaría el acceso escrito en un lugar que el dueño jamás mira, que es igual a no escribirlo.
  assert.ok(tipo.codigo.startsWith("gobierno."));

  const [usuarioA] = await app.sql("select id::text as id from usuarios where persona_id = $1", [
    personaA.id,
  ]);
  await app.sql(
    `insert into eventos (tipo_id, objeto_tabla, objeto_id, actor_id, event_time, tz_offset_min, payload)
     select t.id, 'personas', $1::uuid, $2::uuid, now(), -240, $3::jsonb
       from evento_tipo t where t.codigo = 'gobierno.arco_exportado'`,
    [personaA.id, usuarioA.id, JSON.stringify({ usuarios: 1, dispositivos: 1 })],
  );
  const [visto] = await app.sql(
    `select e.payload from eventos e join evento_tipo t on t.id = e.tipo_id
      where t.codigo like 'gobierno.%' and e.objeto_id = $1::uuid`,
    [personaA.id],
  );
  assert.ok(visto, "el acceso tiene que quedar en la bitácora que el dueño lee (§3.E1.15)");
  // NADA de PII en el payload: `eventos` es append-only (§7.4) y el gate del §7.8 lo prohíbe.
  assert.deepEqual(visto.payload, { usuarios: 1, dispositivos: 1 });
  assert.ok(!JSON.stringify(visto.payload).includes(RUT_A));
});

// ─── La lista blanca del SELECT, contra hashes que SÍ están en la base ────────────────

test("[AC-FIDN-15] las consultas del export no traen ni una credencial de la base", async () => {
  const [titular] = await app.sql(SQL_TITULAR, [personaA.id]);
  const usuarios = await app.sql(SQL_USUARIOS, [personaA.id]);
  const dispositivos = await app.sql(SQL_DISPOSITIVOS, [personaA.id]);

  // El fixture los tiene puestos: si el SELECT fuera `*`, acá habría hashes.
  const [conHash] = await app.sql(
    "select pin_hash from usuarios where persona_id = $1",
    [personaA.id],
  );
  assert.equal(conHash.pin_hash, PIN_HASH_A, "el fixture perdió el hash y la prueba no probaría nada");

  const claves = [titular, ...usuarios, ...dispositivos].flatMap((f) => Object.keys(f));
  for (const vedado of CAMPOS_VEDADOS) {
    assert.ok(!claves.includes(vedado), `la consulta trajo «${vedado}» desde la base`);
  }
});

// ─── El documento entero: ni una cadena del tercero ───────────────────────────────────

test("[AC-FIDN-15] el export de A no contiene UN SOLO dato de B ni del andén", async () => {
  const [titular] = await app.sql(SQL_TITULAR, [personaA.id]);
  const usuarios = await app.sql(SQL_USUARIOS, [personaA.id]);
  const dispositivos = await app.sql(SQL_DISPOSITIVOS, [personaA.id]);

  const doc = armarExportArco({
    generadoEn: new Date("2026-08-15T18:30:00.000Z"),
    tenant: SLUG,
    titular,
    usuarios,
    dispositivos,
  });

  // Lo suyo SÍ está: sin este positivo, un export vacío pasaría todos los negativos.
  assert.equal(doc.titular.rut, RUT_A);
  assert.equal(doc.titular.nombre, NOMBRE_A);
  assert.equal(doc.titular.contacto, CONTACTO_A);
  assert.equal(doc.usuarios.length, 1);
  assert.equal(doc.usuarios[0].rol, "chofer");
  assert.equal(doc.dispositivos.length, 1);
  assert.equal(doc.dispositivos[0].tipo, "personal");

  // Y lo ajeno NO, buscado sobre el JSON serializado y no campo por campo: una comparación por
  // campo solo cubre los campos que alguien se acordó de mirar.
  const serializado = JSON.stringify(doc);
  for (const ajeno of [RUT_B, NOMBRE_B, CONTACTO_B, personaB.id, SECRETO_HASH_A, PIN_HASH_A]) {
    assert.ok(!serializado.includes(ajeno), `el documento de A se llevó «${ajeno}»`);
  }
  assert.deepEqual(camposVedadosEn(doc), []);
});

test("[AC-FIDN-15] borrar el `where` de la consulta pone ESTA prueba roja, no el gate de nadie", async () => {
  // La regresión concreta que la segunda capa existe para atrapar: la consulta sin filtro trae
  // a todo el tenant, y el armado rebota ANTES de entregar nada.
  const [titular] = await app.sql(SQL_TITULAR, [personaA.id]);
  const todos = await app.sql(SQL_USUARIOS.replace("where persona_id = $1::uuid", "where $1::uuid is not null"), [
    personaA.id,
  ]);
  assert.ok(todos.length > 1, "el fixture tiene que tener más de una persona para que esto pruebe algo");
  assert.throws(
    () => armarExportArco({ generadoEn: new Date(), tenant: SLUG, titular, usuarios: todos, dispositivos: [] }),
    /no son de la titular/,
  );
});
