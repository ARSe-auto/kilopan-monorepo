#!/usr/bin/env node
// Visibilidad por grupos jerárquicos, con el rol de app real [AC-FTEN-27].
//
// El AC pedía «pgTAP de la política con el rol de app real», y las dos cosas juntas no se
// pueden: pgTAP corre como superusuario y a un superusuario la RLS no se le aplica nunca. Lo
// que importa —una prueba contra la BD, con el rol `app_t_<slug>` de verdad, sobre la política
// misma— está acá, igual que la RLS de dinero de AC-FTEN-21. La otra mitad del oráculo doble
// es el e2e de cada superficie, y vive en el módulo que la tiene: ninguna de las tres existe
// en el hito (a).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_grupos";
const FIXTURE = "fixture_vehiculos";

let tenant;
let app;
let migrador;
/** El árbol: norte → { norte_a → norte_a1, norte_b } y sur, que no cuelga de norte. */
const G = {};

/** Corre `fn` con el grupo declarado por SET LOCAL, igual que el rol (§4.1, §7.2). */
async function comoGrupo(grupo, fn) {
  await app.sql("begin");
  try {
    if (grupo !== null) await app.sql("select set_config('app.current_grupo', $1, true)", [grupo]);
    return await fn();
  } finally {
    await app.sql("commit");
  }
}

const visibles = async (grupo) =>
  (await comoGrupo(grupo, () => app.sql(`select patente from ${FIXTURE} order by patente`))).map(
    (f) => f.patente,
  );

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
  tenant = await provisionar(SLUG, { recrear: true });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });

  for (const [nombre, padre] of [
    ["norte", null],
    ["norte_a", "norte"],
    ["norte_a1", "norte_a"],
    ["norte_b", "norte"],
    ["sur", null],
  ]) {
    const [g] = await migrador.sql(
      "insert into grupos (nombre, padre_id) values ($1, $2) returning id::text as id",
      [nombre, padre ? G[padre] : null],
    );
    G[nombre] = g.id;
  }

  // Tabla FIXTURE de entidades adscribibles: `vehiculos` es del hito c, así que el mecanismo
  // se ejerce sobre una del harness — mismo patrón que la RLS de dinero.
  await migrador.sql(`create table ${FIXTURE} (
    id        uuid not null primary key default uuidv7(),
    tenant_id uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
    patente   text not null,
    grupo_id  uuid,
    unique (tenant_id, id),
    foreign key (tenant_id, grupo_id) references grupos (tenant_id, id)
  )`);
  await migrador.sql(`select aplicar_visibilidad_por_grupo('${FIXTURE}')`);
  await migrador.sql(
    `insert into ${FIXTURE} (patente, grupo_id) values
       ('AA-11', $1), ('AB-22', $2), ('AC-33', $3), ('AD-44', $4), ('ZZ-99', null)`,
    [G.norte, G.norte_a, G.norte_a1, G.sur],
  );
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FTEN-27] el alcance de un grupo es su nodo Y todos sus descendientes", async () => {
  const alcance = async (grupo) =>
    (await migrador.sql("select grupos_en_alcance($1)::text as g", [grupo])).map((f) => f.g).sort();

  assert.deepEqual(await alcance(G.norte), [G.norte, G.norte_a, G.norte_a1, G.norte_b].sort());
  assert.deepEqual(await alcance(G.norte_a), [G.norte_a, G.norte_a1].sort());
  assert.deepEqual(await alcance(G.norte_a1), [G.norte_a1]);
  assert.deepEqual(await alcance(G.sur), [G.sur], "sur no cuelga de norte y no arrastra nada");
});

test("[AC-FTEN-27] un usuario del nodo alto ve su rama entera (herencia hacia abajo)", async () => {
  assert.deepEqual(await visibles(G.norte), ["AA-11", "AB-22", "AC-33", "ZZ-99"]);
});

test("[AC-FTEN-27] un usuario de un nodo hijo NO ve las filas de un grupo que no es su descendiente", async () => {
  // Es el caso que el AC pide literalmente: usuario del grupo X ⇒ 0 filas de entidades del
  // grupo Y que no sea su ancestro. Y también hacia arriba: `norte_a` no ve lo de `norte`.
  const desdeA = await visibles(G.norte_a);
  assert.deepEqual(desdeA, ["AB-22", "AC-33", "ZZ-99"]);
  assert.ok(!desdeA.includes("AD-44"), "vio un vehículo de otra rama");
  assert.ok(!desdeA.includes("AA-11"), "vio hacia ARRIBA: la herencia es solo hacia abajo");

  assert.deepEqual(await visibles(G.sur), ["AD-44", "ZZ-99"]);
});

test("[AC-FTEN-27] una fila SIN grupo la ve cualquiera: el grupo acota, no esconde", async () => {
  // Si adscribir fuera obligatorio para ser visible, el día que alguien cree un vehículo sin
  // asignarle grupo el vehículo desaparece del inventario y nadie entiende por qué. La falla
  // no puede ser perder datos de vista.
  for (const g of [G.norte, G.norte_a, G.norte_a1, G.sur]) {
    assert.ok((await visibles(g)).includes("ZZ-99"), "una fila sin grupo se volvió invisible");
  }
});

test("[AC-FTEN-27] sin `app.current_grupo` declarado no se ven filas adscritas", async () => {
  // El §7.2 obliga a declarar el contexto en CADA transacción. No declararlo es un bug, y ante
  // un bug el filtro se aplica en vez de desaparecer — misma falla hacia el cierre que la RLS
  // de dinero. Las filas sin grupo se siguen viendo: no es un apagón, es un filtro.
  assert.deepEqual(await visibles(null), ["ZZ-99"]);
});

test("[AC-FTEN-27] el grupo viaja por SET LOCAL: no sobrevive a su transacción", async () => {
  await comoGrupo(G.norte, async () => {
    assert.ok((await app.sql(`select 1 from ${FIXTURE} where patente = 'AA-11'`)).length === 1);
  });
  assert.deepEqual(await visibles(null), ["ZZ-99"], "el grupo sobrevivió: era SET de sesión");
});

test("[AC-FTEN-27] la composición con el rol es INTERSECCIÓN, y se prueba en los dos sentidos", async () => {
  // El rol define QUÉ acciones, el grupo QUÉ filas (§4.4, respuesta P12(c)). Ninguno amplía el
  // alcance del otro: se prueba que declarar un rol no agrega filas de otra rama, y que
  // declarar un grupo amplio no habilita una acción que el rol no tiene.
  await app.sql("begin");
  try {
    await app.sql("select set_config('app.current_grupo', $1, true)", [G.norte_a]);
    await app.sql("select set_config('app.current_role', 'admin_tenant', true)");
    const patentes = (await app.sql(`select patente from ${FIXTURE} order by patente`)).map(
      (f) => f.patente,
    );
    assert.ok(!patentes.includes("AD-44"), "el rol más alto amplió el alcance del grupo");
  } finally {
    await app.sql("commit");
  }

  // Y al revés: el grupo no le da ownership ni DDL a la app, que es lo que el rol gobierna.
  await comoGrupo(G.norte, async () => {
    await assert.rejects(() => app.sql(`create table intruso_grupo (id uuid primary key)`), {
      code: "42501",
    });
  });
});

test("[AC-FTEN-27] la política es RESTRICTIVE y FOR SELECT: la captura del terreno no rebota", async () => {
  const politicas = await migrador.sql(
    "select polname, polpermissive, polcmd from pg_policy where polrelid = $1::regclass",
    [FIXTURE],
  );
  const restrictiva = politicas.find((p) => !p.polpermissive);
  assert.ok(restrictiva, "no hay política RESTRICTIVE: la intersección con el rol es un AND");
  assert.equal(restrictiva.polcmd, "r", "no es FOR SELECT: el grupo define filas, no acciones");

  // La consecuencia concreta: un chofer del grupo norte puede ESCRIBIR sobre un vehículo del
  // sur —que no ve— sin que la base rebote. El flujo del terreno jamás rebota (§4.2).
  await comoGrupo(G.norte, () =>
    app.sql(`insert into ${FIXTURE} (patente, grupo_id) values ('AE-55', $1)`, [G.sur]),
  );
  assert.ok((await visibles(G.sur)).includes("AE-55"));
});
