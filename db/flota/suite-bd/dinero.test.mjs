#!/usr/bin/env node
// El patrón de RLS de dinero, con el rol de app real [AC-FTEN-21].
//
// Esto NO se puede probar con pgTAP: pgTAP corre como superusuario y la RLS no se le aplica.
// Hace falta el rol `app_t_<slug>` de verdad, que es exactamente el sujeto del §4.8.
//
// Ninguna tabla de montos del §4.8 nace en este módulo (son de los hitos c y f). Lo que este
// módulo entrega es el PATRÓN —`aplicar_rls_de_dinero(regclass)`— y acá se lo ejerce sobre
// una tabla FIXTURE del harness, que se crea y se borra con el tenant de la prueba.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_dinero";
const FIXTURE = "fixture_costos";

let tenant;
let app;
let migrador;

/** Corre `fn` dentro de una transacción con el rol declarado por SET LOCAL (§4.1, §7.2). */
async function comoRol(rol, fn) {
  await app.sql("begin");
  try {
    if (rol !== null) await app.sql("select set_config('app.current_role', $1, true)", [rol]);
    return await fn();
  } finally {
    await app.sql("commit");
  }
}

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

  // La tabla FIXTURE de montos: `costo_clp` NULLABLE a propósito, porque el cierre de recarga
  // del chofer entra SIN monto y el operador (o un trigger) lo completa después (§4.8).
  await migrador.sql(`create table ${FIXTURE} (
    id        uuid   not null primary key default uuidv7(),
    tenant_id uuid   not null default tenant_actual() check (tenant_id = tenant_actual()),
    concepto  text   not null,
    costo_clp bigint,
    unique (tenant_id, id)
  )`);
  await migrador.sql(`select aplicar_rls_de_dinero('${FIXTURE}')`);
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FTEN-21] el patrón deja la tabla con RLS y las DOS políticas del §4.8", async () => {
  const [{ rls }] = await migrador.sql(
    "select relrowsecurity as rls from pg_class where relname = $1",
    [FIXTURE],
  );
  assert.equal(rls, true, "la tabla de montos quedó sin RLS: el patrón no se aplicó");

  const politicas = await migrador.sql(
    "select polname, polpermissive, polcmd from pg_policy where polrelid = $1::regclass order by polname",
    [FIXTURE],
  );
  assert.equal(politicas.length, 2, "faltan políticas: una RLS sin permisiva le niega la tabla a cualquiera");

  const restrictiva = politicas.find((p) => !p.polpermissive);
  assert.ok(restrictiva, "no hay política RESTRICTIVE: la del §4.8 es restrictiva");
  assert.equal(
    restrictiva.polcmd,
    "r",
    "la RESTRICTIVE no es FOR SELECT únicamente: una total rebotaría el INSERT del chofer",
  );
});

test("[AC-FTEN-21] con un rol autorizado, los montos se ven (sin esto todo lo demás sería vacuo)", async () => {
  await comoRol("operador", () =>
    app.sql(`insert into ${FIXTURE} (concepto, costo_clp) values ('recarga cerrada', 12500)`),
  );
  const filas = await comoRol("operador", () => app.sql(`select concepto, costo_clp from ${FIXTURE}`));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].costo_clp, "12500");
});

for (const rol of ["chofer", "responsable_carga"]) {
  test(`[AC-FTEN-21] con rol \`${rol}\` el SELECT de montos devuelve 0 filas`, async () => {
    const filas = await comoRol(rol, () => app.sql(`select * from ${FIXTURE}`));
    assert.deepEqual(filas, [], `${rol} vio montos`);
  });
}

test("[AC-FTEN-21] el chofer NO ve montos pero su captura con costo NULL entra sin rebote", async () => {
  // Es la corrección explícita del maestro: una RESTRICTIVE total rebotaría el INSERT del
  // cierre de recarga, y el flujo del terreno JAMÁS rebota (§4.2). Por eso FOR SELECT.
  await comoRol("chofer", async () => {
    await app.sql(`insert into ${FIXTURE} (concepto, costo_clp) values ('recarga del chofer', null)`);
  });

  // Y la fila existe de verdad: entró, no se descartó en silencio.
  const filas = await comoRol("operador", () =>
    app.sql(`select concepto, costo_clp from ${FIXTURE} where concepto = 'recarga del chofer'`),
  );
  assert.equal(filas.length, 1, "la captura del chofer no llegó a la base");
  assert.equal(filas[0].costo_clp, null, "el monto lo completa el operador, no el chofer");
});

test("[AC-FTEN-21] sin `app.current_role` declarado no se ven montos: la falla es hacia el cierre", async () => {
  // `current_setting(..., true)` devuelve NULL cuando nadie lo puso. Una transacción que se
  // olvidó de declarar su rol tiene que NO ver dinero, no verlo todo.
  const filas = await comoRol(null, () => app.sql(`select * from ${FIXTURE}`));
  assert.deepEqual(filas, []);
});

test("[AC-FTEN-21] el rol viaja por SET LOCAL: no sobrevive a la transacción que lo puso", async () => {
  // En un pool, un SET de sesión se lo lleva la siguiente transacción de OTRO usuario (§7.2).
  // Que el permiso se evapore al cerrar es la prueba de que es LOCAL.
  const dentro = await comoRol("operador", () => app.sql(`select count(*)::int as n from ${FIXTURE}`));
  assert.ok(dentro[0].n > 0);

  // Postgres deja el parámetro DEFINIDO y en CADENA VACÍA cuando la transacción del SET LOCAL
  // termina — no lo borra. Por eso la política trata '' igual que «sin declarar»: si mirara
  // solo NULL, la transacción siguiente del pool heredaría el permiso.
  const [{ resto }] = await app.sql(
    "select coalesce(current_setting('app.current_role', true), '(nulo)') as resto",
  );
  assert.ok(
    resto === "" || resto === "(nulo)",
    `el rol sobrevivió a su transacción («${resto}»): era SET de sesión`,
  );

  const fuera = await comoRol(null, () => app.sql(`select count(*)::int as n from ${FIXTURE}`));
  assert.equal(fuera[0].n, 0, "fuera de una transacción con rol declarado igual se vieron montos");
});
