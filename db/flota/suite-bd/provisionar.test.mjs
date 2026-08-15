#!/usr/bin/env node
// Provisión contra el cluster real [AC-FTEN-02].
//
// Esta suite es la mitad del AC que NO se puede fingir: `CREATE DATABASE … TEMPLATE`, la
// siembra de `tenant_info` con uuid del servidor y el horneado de `tenant_actual()` solo
// existen si hay un PostgreSQL de verdad al otro lado (§4.1; por eso el cluster propio del
// 54331 y no PGlite). Corre con `--full`.
//
// Deja vivos `t_gate_a` y `t_gate_b`: son las DOS BD de tenant que el AC exige provisionar
// desde la plantilla en CADA corrida del gate, y quedan como evidencia inspeccionable.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  provisionar,
  refrescarPlantilla,
  auditarPlantilla,
  versionesDe,
  basesDeTenant,
  UUID_CENTINELA_PLANTILLA,
} from "../provisionar.mjs";
import { con, conectar, BD_CONTROL, BD_PLANTILLA, bdDeTenant } from "../conectar.mjs";
import { desregistrar } from "./desregistrar.mjs";
import { versionEsperada } from "../aplicar.mjs";

const RAIZ = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const PROVISIONAR = join(RAIZ, "db/flota/provisionar.mjs");

/** Los dos tenants del AC, más el tercero que solo existe para romper la plantilla. */
const A = "gate_a";
const B = "gate_b";
const REZAGADO = "gate_rezagado";

async function borrar(slug) {
  await con("postgres", ({ sql }) =>
    sql(`drop database if exists ${bdDeTenant(slug)} with (force)`),
  );
  // Con el alta persistida [AC-FPOR-01], dropear la base sola deja la fila huérfana en
  // `control.tenants` y el exportador de la corrida SIGUIENTE la nombra como rezago.
  await desregistrar(slug);
}

/** El CLI, devolviendo `{ codigo, salida }` en vez de tirar: acá el exit code ES el aserto. */
function cli(...args) {
  try {
    const salida = execFileSync("node", [PROVISIONAR, ...args], { encoding: "utf8", stdio: "pipe" });
    return { codigo: 0, salida };
  } catch (e) {
    return { codigo: e.status, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

before(async () => {
  // Sin cluster esta suite NO se salta: se cae. Un paso saltado no es un paso verde.
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  await borrar(REZAGADO);
});

test("[AC-FTEN-02] `tenant_template` es un artefacto del repo: se construye desde las migraciones", async () => {
  const r = await refrescarPlantilla();
  assert.ok(r.aplicadas.length + r.yaEstaban.length > 0, "la plantilla no aplicó ni una migración");
  assert.equal((await versionesDe(BD_PLANTILLA)).at(-1), versionEsperada("tenant"));

  // La plantilla no es un tenant: sin fila de identidad y con el centinela por constante.
  await con(BD_PLANTILLA, async ({ sql }) => {
    const [{ n }] = await sql("select count(*)::int as n from tenant_info");
    assert.equal(n, 0, "la plantilla tiene identidad sembrada: sería un tenant disfrazado");
    const [{ actual }] = await sql("select tenant_actual()::text as actual");
    assert.equal(actual, UUID_CENTINELA_PLANTILLA);
    const [{ ok }] = await sql("select tenant_coherente() as ok");
    assert.equal(ok, true);
  });
});

test("[AC-FTEN-02] provisiona DOS BD de tenant desde la plantilla, cada una con su identidad", async () => {
  const a = await provisionar(A, { recrear: true });
  const b = await provisionar(B, { recrear: true });

  assert.equal(a.bd, "t_gate_a");
  assert.equal(b.bd, "t_gate_b");
  assert.notEqual(a.id, b.id, "dos tenants con el mismo id no están separados de nada");

  for (const t of [a, b]) {
    // UUIDv7 generado en el servidor (§0): el nibble de versión del tercer grupo es 7.
    assert.equal(t.id[14], "7", `${t.bd} no tiene un uuid de versión 7`);

    await con(t.bd, async ({ sql }) => {
      const filas = await sql("select id::text as id, slug from tenant_info");
      assert.equal(filas.length, 1, `${t.bd}: tenant_info debe tener exactamente una fila`);
      assert.deepEqual(filas[0], { id: t.id, slug: t.slug });

      const [{ actual }] = await sql("select tenant_actual()::text as actual");
      assert.equal(actual, t.id, `${t.bd}: la constante de la BD no es su propio id`);
      const [{ ok }] = await sql("select tenant_coherente() as ok");
      assert.equal(ok, true);

      // Hereda el esquema completo de la plantilla, no un pedazo.
      assert.deepEqual(await versionesDe(t.bd), await versionesDe(BD_PLANTILLA));
    });
  }

  const vivas = await basesDeTenant();
  assert.ok(vivas.includes("t_gate_a") && vivas.includes("t_gate_b"));
});

// --- Alta persistida en `control.tenants` [AC-FPOR-01] -----------------------------------
// `control.tenants` es la AUTORIDAD que lee el ruteo y de la que se resuelve el preset de
// entitlements (§4.4) — hasta acá la provisión creaba la BD del tenant y dejaba esa fila
// sin escribir (deuda documentada en `tenantIdEnControl`, `apps/flota/src/servidor/gobierno.ts`).
// El wizard de AC-FMIG-14 va a invocar `provisionar()` como su servicio de alta: esto prueba
// que el modo que ese botón elija efectivamente queda persistido.

test("[AC-FPOR-01] el alta persiste el modo elegido en `control.tenants`", async () => {
  const t = await provisionar("gate_modo_daas", { recrear: true, modo: "daas" });
  try {
    const [fila] = await con(BD_CONTROL, ({ sql }) =>
      sql("select slug, bd, modo::text as modo from tenants where slug = $1", [t.slug]),
    );
    assert.deepEqual(fila, { slug: "gate_modo_daas", bd: "t_gate_modo_daas", modo: "daas" });
    assert.equal(t.modo, "daas", "provisionar() debe devolver el modo con el que dio de alta");
  } finally {
    await con(BD_CONTROL, ({ sql }) => sql("delete from tenants where slug = $1", [t.slug]));
    await borrar("gate_modo_daas");
  }
});

test("[AC-FPOR-01] sin modo explícito, el alta persiste el default `mi_flota`", async () => {
  const t = await provisionar("gate_modo_default", { recrear: true });
  try {
    const [{ modo }] = await con(BD_CONTROL, ({ sql }) =>
      sql("select modo::text as modo from tenants where slug = $1", [t.slug]),
    );
    assert.equal(modo, "mi_flota");
    assert.equal(t.modo, "mi_flota");
  } finally {
    await con(BD_CONTROL, ({ sql }) => sql("delete from tenants where slug = $1", [t.slug]));
    await borrar("gate_modo_default");
  }
});

test("[AC-FPOR-01] recrear el mismo tenant conserva el `id` de `control.tenants` (los grants no quedan huérfanos)", async () => {
  const primero = await provisionar("gate_modo_recrear", { recrear: true, modo: "mi_flota" });
  try {
    const [antes] = await con(BD_CONTROL, ({ sql }) =>
      sql("select id::text as id from tenants where slug = $1", [primero.slug]),
    );
    const segundo = await provisionar("gate_modo_recrear", { recrear: true, modo: "daas" });
    const [despues] = await con(BD_CONTROL, ({ sql }) =>
      sql("select id::text as id, modo::text as modo from tenants where slug = $1", [
        segundo.slug,
      ]),
    );
    assert.equal(despues.id, antes.id, "recrear no puede volarle el id a control.tenants");
    assert.equal(despues.modo, "daas", "la segunda alta debe pisar el modo con el nuevo valor");

    const filas = await con(BD_CONTROL, ({ sql }) =>
      sql("select count(*)::int as n from tenants where slug = $1", [primero.slug]),
    );
    assert.equal(filas[0].n, 1, "recrear no puede dejar dos filas del mismo slug en control");
  } finally {
    await con(BD_CONTROL, ({ sql }) => sql("delete from tenants where slug = $1", ["gate_modo_recrear"]));
    await borrar("gate_modo_recrear");
  }
});

test("[AC-FPOR-01] `control.tenants.modo` fuera del dominio mi_flota|daas rebota en la BD (CHECK del enum), 0 filas", async () => {
  await assert.rejects(
    () =>
      con(BD_CONTROL, ({ sql }) =>
        sql("insert into tenants (slug, bd, modo) values ('gate_modo_enum', 't_gate_modo_enum', 'premium')"),
      ),
    { code: "22P02" }, // invalid input value for enum tenant_modo
  );
  const filas = await con(BD_CONTROL, ({ sql }) =>
    sql("select count(*)::int as n from tenants where slug = 'gate_modo_enum'"),
  );
  assert.equal(filas[0].n, 0, "el rebote del enum no puede dejar la fila a medias");
});

test("[AC-FTEN-02] `tenant_info` es fila única: una segunda identidad rebota en la BD", async () => {
  await assert.rejects(
    () =>
      con(bdDeTenant(A), ({ sql }) =>
        sql("insert into tenant_info (id, slug) values (uuidv7(), 'intruso')"),
      ),
    /duplicate key|unica/i,
    "dos filas en tenant_info serían dos tenants compartiendo una base",
  );
});

test("[AC-FTEN-02] el alta de un tenant no pisa a otro: sin --recrear, base existente rebota", async () => {
  await assert.rejects(() => provisionar(A), /ya existe/);
  // Y la de al lado sigue intacta después del rebote.
  await con(bdDeTenant(A), async ({ sql }) => {
    const [{ n }] = await sql("select count(*)::int as n from tenant_info");
    assert.equal(n, 1);
  });
});

test("[AC-FTEN-02] con una conexión abierta contra la plantilla, la provisión falla EXPLICANDO por qué", async () => {
  // PostgreSQL responde «source database is being accessed by other users», que no le dice
  // a nadie qué hacer. El mensaje propio es el que convierte el rebote en una instrucción.
  const espia = await conectar(BD_PLANTILLA);
  try {
    await assert.rejects(() => provisionar("gate_espiado", { recrear: true }), /conexión\(es\) abierta/);
  } finally {
    await espia.cerrar();
  }
});

test("[AC-FTEN-02] lo que la plantilla trae sembrado se ADOPTA con el id del tenant nuevo", async () => {
  // Una migración puede sembrar catálogos —el registro de `ProveedorTelemetria` del §4.9 lo
  // hace—, y esas filas nacen en la plantilla con el `tenant_id` CENTINELA, porque ahí
  // `tenant_actual()` devuelve el centinela. Al copiarse quedaban atadas a un tenant que no
  // existe, y el CHECK no las revalidaba: PostgreSQL no reevalúa constraints al reemplazar la
  // función. Pasaban desapercibidas hasta el primer `pg_dump` + restore, que es exactamente
  // como se descubrió (suite de offboarding, AC-FTEN-17).
  const t = await provisionar("gate_adopcion", { recrear: true });
  try {
    const filas = await con(t.bd, ({ sql }) =>
      sql("select tenant_id::text as tenant_id, fuente from proveedor_telemetria"),
    );
    assert.ok(filas.length > 0, "la plantilla dejó de traer filas sembradas: la prueba quedó vacua");
    for (const f of filas) {
      assert.equal(f.tenant_id, t.id, `${f.fuente} quedó atada al centinela de la plantilla`);
    }
  } finally {
    await borrar("gate_adopcion");
  }
});

test("[AC-FTEN-02] un alta que falla a mitad NO deja la base en pie", async () => {
  // Una base creada y sin sembrar es peor que ninguna: parece provisionada, `tenant_actual()`
  // devuelve el centinela de la plantilla y todo lo que se escriba ahí queda atado a un tenant
  // que no existe. Pasó de verdad con `t_canary` tras un arranque en frío fallido, y lo
  // encontró la suite pgTAP de AC-FTEN-08 — no esta.
  //
  // La falla se fuerza sembrando una identidad EN LA PLANTILLA: la copia nace con la fila
  // puesta y el INSERT de la provisión choca con el «una sola fila, para siempre».
  await con(BD_PLANTILLA, ({ sql }) =>
    sql("insert into tenant_info (id, slug) values (uuidv7(), 'intruso_en_la_plantilla')"),
  );
  try {
    await assert.rejects(() => provisionar("gate_a_medias", { recrear: true }), /se deshizo/);
    const vivas = await basesDeTenant();
    assert.ok(
      !vivas.includes(bdDeTenant("gate_a_medias")),
      "la base a medio provisionar quedó en pie",
    );
  } finally {
    await con(BD_PLANTILLA, ({ sql }) => sql("delete from tenant_info"));
  }
});

test("[AC-FTEN-02] CASO DE REBOTE: migración en un tenant y no en la plantilla ⇒ exit ≠ 0", async () => {
  // Antes de romper nada, el gate está verde: si no, el rojo de abajo no probaría nada.
  assert.equal(cli("auditar").codigo, 0, "el cluster ya estaba rezagado antes de la prueba");

  await provisionar(REZAGADO, { recrear: true });
  await con(bdDeTenant(REZAGADO), async ({ sql }) => {
    // Una migración que llegó a la BD del tenant y nunca a la plantilla: exactamente lo que
    // pasa cuando alguien aplica un parche a mano y se olvida de la 4ª vida del esquema.
    await sql("create table parche_a_mano (id uuid primary key default uuidv7())");
    await sql(
      "insert into schema_migrations (version, sha256) values ('0002_parche_a_mano', repeat('0', 64))",
    );
  });

  const { motivos } = await auditarPlantilla();
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /0002_parche_a_mano/);
  assert.match(motivos[0], /t_gate_rezagado/);

  const roto = cli("auditar");
  assert.notEqual(roto.codigo, 0, "la plantilla rezagada dejó el gate en verde");
  assert.match(roto.salida, /0002_parche_a_mano/);
  assert.match(roto.salida, /ROJO/);

  // Y al quitar la base rezagada vuelve a verde, sin tocar nada más: el rojo era por eso.
  await borrar(REZAGADO);
  const sano = cli("auditar");
  assert.equal(sano.codigo, 0, sano.salida);
  assert.match(sano.salida, /VERDE/);
});
