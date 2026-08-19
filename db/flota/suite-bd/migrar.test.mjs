#!/usr/bin/env node
// Runner ×N contra el cluster real [AC-FTEN-07].
//
// Acá se prueba lo que ninguna función pura puede probar: que el recorrido de verdad pasa por
// todas las bases, que lo hace con el rol `migrator` y no con el superusuario, y que el
// centinela 13 pone el deploy en rojo cuando alguna base quedó atrás. Corre con `--full`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrar, verificar } from "../migrar.mjs";
import {
  asegurarRolMigrador,
  basesDeTenant,
  duenoDe,
  identidadesRotas,
} from "../provisionar.mjs";
import { con, BD_PLANTILLA, ROL_MIGRADOR, TENANT_CANARIO, bdDeTenant } from "../conectar.mjs";
import { DIR_MIGRACIONES, versionEsperada } from "../aplicar.mjs";

const RAIZ = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const MIGRAR = join(RAIZ, "db/flota/migrar.mjs");
const AJENA = "t_gate_ajena";

function cli(...args) {
  try {
    return { codigo: 0, salida: execFileSync("node", [MIGRAR, ...args], { encoding: "utf8" }) };
  } catch (e) {
    return { codigo: e.status, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Un directorio de migraciones con una versión MÁS que el repo: nadie la tiene aplicada. */
function dirConUnaDeMas() {
  const dir = mkdtempSync(join(tmpdir(), "flota-migraciones-"));
  cpSync(join(DIR_MIGRACIONES, "tenant"), join(dir, "tenant"), { recursive: true });
  // `verificar` no aplica nada, así que el contenido no se ejecuta: lo que importa es que la
  // última versión en disco deje de ser la que las bases tienen.
  writeFileSync(join(dir, "tenant", "9999_todavia_no_aplicada.sql"), "select 1;\n");
  return dir;
}

async function borrarAjena() {
  await con("postgres", ({ sql }) => sql(`drop database if exists ${AJENA} with (force)`));
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
  await borrarAjena();
});

after(borrarAjena);

test("[AC-FTEN-07] el recorrido pasa por el canario PRIMERO, la plantilla después y luego los tenants", async () => {
  const { orden, resultados } = await migrar();

  assert.equal(orden[0], bdDeTenant(TENANT_CANARIO), "el canario no fue la primera base");
  assert.equal(orden[1], BD_PLANTILLA, "la plantilla no fue la segunda base");
  assert.deepEqual(
    resultados.map((r) => r.bd),
    orden,
    "el orden aplicado no es el orden declarado",
  );

  const vivas = await basesDeTenant();
  for (const bd of vivas) assert.ok(orden.includes(bd), `${bd} quedó fuera del recorrido`);
});

test("[AC-FTEN-07] cada base tiene su PROPIA `schema_migrations`, todas en la última versión", async () => {
  const { esperada, bases } = await verificar();
  assert.equal(esperada, versionEsperada("tenant"));
  assert.ok(bases.length >= 2, "el recorrido no visitó ni el canario ni la plantilla");
  for (const b of bases) assert.equal(b.version, esperada, `${b.bd} quedó rezagada`);
});

test("[AC-FTEN-07] las migraciones corren como `migrator`, no como el superusuario", async () => {
  const { resultados } = await migrar();
  for (const r of resultados) {
    assert.equal(r.usuario, ROL_MIGRADOR, `${r.bd} se migró como ${r.usuario}`);
  }

  await asegurarRolMigrador();
  const [rol] = await con("postgres", ({ sql }) =>
    sql("select rolsuper, rolbypassrls, rolcreatedb from pg_roles where rolname = $1", [
      ROL_MIGRADOR,
    ]),
  );
  assert.ok(rol, `no existe el rol ${ROL_MIGRADOR}`);
  assert.equal(rol.rolsuper, false, "un migrator superusuario no está separado de nada");
  assert.equal(rol.rolbypassrls, false);
  assert.equal(rol.rolcreatedb, false, "crear bases es del alta de tenant, no del migrador");

  // Y el ownership vive en `migrator`: es lo que después deja al rol de app SIN ownership
  // (la mitad que le toca a AC-FTEN-03 es el rol `app_t_<slug>` y su CONNECT acotado).
  for (const bd of [BD_PLANTILLA, ...(await basesDeTenant())]) {
    assert.equal(await duenoDe(bd), ROL_MIGRADOR, `${bd} no pertenece a ${ROL_MIGRADOR}`);
  }
});

test("[AC-FTEN-07] una base de dueño ajeno detiene el runner nombrándola, en vez de fallar sola", async () => {
  // Sin este guard, el rebote sería un «permission denied for table schema_migrations» que no
  // dice qué base ni qué hacer — el error que costó la primera corrida de este runner.
  await con("postgres", ({ sql }) => sql(`create database ${AJENA} template ${BD_PLANTILLA}`));
  assert.notEqual(await duenoDe(AJENA), ROL_MIGRADOR);

  await assert.rejects(() => migrar(), new RegExp(`${AJENA}.*no puede`, "s"));
  await borrarAjena();
  assert.equal((await verificar()).motivos.length, 0, "el cluster no quedó como estaba");
});

test("[AC-FTEN-07] una base de tenant SIN identidad sembrada también deja el deploy en rojo", async () => {
  // Al día pero sin `tenant_info` está tan rota como una atrasada: `tenant_actual()` devuelve
  // el centinela de la plantilla, el CHECK de cada tabla de dominio compara contra él y pasa,
  // y las filas quedan atadas a un tenant que no existe. `t_canary` estuvo así y ni el runner
  // ni la auditoría de la plantilla lo veían.
  assert.equal(cli("verificar").codigo, 0, "el cluster ya estaba roto antes de la prueba");

  const sinIdentidad = "t_gate_sin_identidad";
  await con("postgres", ({ sql }) =>
    sql(`create database ${sinIdentidad} owner ${ROL_MIGRADOR} template ${BD_PLANTILLA}`),
  );
  try {
    const motivos = await identidadesRotas();
    assert.equal(motivos.length, 1);
    assert.match(motivos[0], new RegExp(sinIdentidad));
    assert.match(motivos[0], /0 filas en tenant_info/);

    const rojo = cli("verificar");
    assert.notEqual(rojo.codigo, 0, "el deploy se declaró verde con una base sin identidad");
    assert.match(rojo.salida, new RegExp(sinIdentidad));
  } finally {
    await con("postgres", ({ sql }) => sql(`drop database if exists ${sinIdentidad} with (force)`));
  }
  assert.equal(cli("verificar").codigo, 0, "el cluster no volvió a su estado");
});

test("[AC-FTEN-07] CENTINELA 13: una migración que ninguna base tiene ⇒ exit ≠ 0", async () => {
  assert.equal(cli("verificar").codigo, 0, "el cluster ya estaba rezagado antes de la prueba");

  const dir = dirConUnaDeMas();
  const { bases, motivos } = await verificar({ dir });
  assert.equal(motivos.length, bases.length, "no todas las bases se reportaron rezagadas");
  assert.match(motivos.join("\n"), new RegExp(bdDeTenant(TENANT_CANARIO)));

  const rojo = cli("verificar", `--dir=${dir}`);
  assert.notEqual(rojo.codigo, 0, "el deploy se declaró verde con bases rezagadas");
  assert.match(rojo.salida, /9999_todavia_no_aplicada/);
  assert.match(rojo.salida, /el deploy no se declara verde/);

  // Y con el directorio real vuelve a verde: el rojo era por el rezago y no por el modo.
  const verde = cli("verificar");
  assert.equal(verde.codigo, 0, verde.salida);
  assert.match(verde.salida, /VERDE/);
});
