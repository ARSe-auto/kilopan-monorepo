#!/usr/bin/env node
// Privilegios del rol de app contra el cluster real [AC-FTEN-03].
//
// Este es el test de privilegios que el AC pide y el centinela 3 del §9.3: las credenciales
// del tenant A contra la BD de B son rechazadas POR POSTGRES, no por una comprobación del
// producto que un bug de routing pueda saltarse. Corre con `--full`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { auditarRolDeApp, borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, BD_PLANTILLA, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const A = "gate_a";
const B = "gate_b";

/** Las dos altas, con sus claves en memoria: no se escriben en ningún lado (§7.1). */
let a;
let b;

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  a = await provisionar(A, { recrear: true });
  b = await provisionar(B, { recrear: true });
});

test("[AC-FTEN-03] el alta del tenant deja su rol con los atributos del §4.1 y sin poseer nada", async () => {
  for (const t of [a, b]) {
    const auditoria = await auditarRolDeApp(t.slug);
    assert.ok(auditoria.atributos, `no existe el rol ${t.rol}`);
    assert.equal(auditoria.atributos.rolsuper, false, "un rol de app superusuario ve todo");
    assert.equal(auditoria.atributos.rolbypassrls, false, "BYPASSRLS anularía la RLS de rol del §4.8");
    assert.equal(auditoria.atributos.rolcreatedb, false);
    assert.equal(auditoria.atributos.rolcreaterole, false);
    assert.equal(auditoria.atributos.rolcanlogin, true, "un rol sin LOGIN no es una credencial");
    assert.equal(auditoria.posee, 0, `${t.rol} es dueño de ${auditoria.posee} objeto(s)`);
  }
});

test("[AC-FTEN-03] CONNECT alcanza EXACTAMENTE su base: ni la del vecino, ni la plantilla, ni `postgres`", async () => {
  const { alcanza } = await auditarRolDeApp(A);
  assert.deepEqual(alcanza, [bdDeTenant(A)]);
  assert.ok(!alcanza.includes(BD_PLANTILLA), "el rol de app alcanza el molde de todos los tenants");
  assert.ok(!alcanza.includes("postgres"), "el rol de app alcanza la base de mantenimiento");
});

test("[AC-FTEN-03] la mitad positiva: con SU clave entra a SU base y lee su identidad", async () => {
  // Sin esta prueba, todo lo de abajo sería verde por un rol que no funciona para nada.
  const propia = await conectar(bdDeTenant(A), { usuario: a.rol, clave: a.clave });
  try {
    const [fila] = await propia.sql("select slug, id::text as id from tenant_info");
    assert.equal(fila.slug, A);
    assert.equal(fila.id, a.id);
  } finally {
    await propia.cerrar();
  }
});

test("[AC-FTEN-03] CENTINELA 3: credenciales de A contra la BD de B ⇒ rechazo de Postgres", async () => {
  await assert.rejects(
    () => conectar(bdDeTenant(B), { usuario: a.rol, clave: a.clave }),
    (e) => {
      assert.equal(e.code, "42501", `Postgres respondió ${e.code}: ${e.message}`);
      assert.match(e.message, new RegExp(bdDeTenant(B)));
      return true;
    },
    "la conexión de A alcanzó la BD de B",
  );
  // Y al revés, para que no sea una asimetría de configuración de una sola base.
  await assert.rejects(() => conectar(bdDeTenant(A), { usuario: b.rol, clave: b.clave }), {
    code: "42501",
  });
});

test("[AC-FTEN-03] la autenticación es real: con la clave equivocada Postgres rechaza (28P01)", async () => {
  // Este test muere si alguien devuelve el `pg_hba` a `trust`: con trust, una clave falsa
  // entra igual y el rechazo del centinela 3 sería solo de privilegio, no de credencial.
  await assert.rejects(
    () => conectar(bdDeTenant(A), { usuario: a.rol, clave: "clavequenoescorrecta00" }),
    { code: "28P01" },
  );
});

test("[AC-FTEN-03] sin ownership de verdad: la app no puede crear ni borrar tablas en su base", async () => {
  const propia = await conectar(bdDeTenant(A), { usuario: a.rol, clave: a.clave });
  try {
    await assert.rejects(() => propia.sql("create table intruso (id uuid primary key)"), {
      code: "42501",
    });
    await assert.rejects(() => propia.sql("drop table tenant_info"), { code: "42501" });
  } finally {
    await propia.cerrar();
  }
});

test("[AC-FTEN-03] una tabla que el migrador cree MAÑANA le queda legible sin regalarle ownership", async () => {
  // `ALTER DEFAULT PRIVILEGES FOR ROLE migrator` es la mitad que se olvida: sin ella, la
  // primera tabla del hito (b) nacería invisible para la app y el atajo sería ownership.
  const bd = bdDeTenant(A);
  const migrador = await conectar(bd, { usuario: ROL_MIGRADOR });
  try {
    await migrador.sql("create table zz_prueba_privilegios (id uuid primary key default uuidv7())");
    const propia = await conectar(bd, { usuario: a.rol, clave: a.clave });
    try {
      assert.deepEqual(await propia.sql("select * from zz_prueba_privilegios"), []);
      await propia.sql("insert into zz_prueba_privilegios default values");
      assert.equal((await propia.sql("select * from zz_prueba_privilegios")).length, 1);
    } finally {
      await propia.cerrar();
    }
  } finally {
    await migrador.sql("drop table if exists zz_prueba_privilegios");
    await migrador.cerrar();
  }
});

after(async () => {
  // Los tenants del gate quedan vivos (AC-FTEN-02); lo efímero es el rol de `gate_espiado`,
  // que la suite de provisión crea y aborta a propósito.
  await borrarRolDeApp("gate_espiado");
});
