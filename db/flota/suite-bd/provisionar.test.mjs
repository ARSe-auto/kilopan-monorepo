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
import { con, conectar, BD_PLANTILLA, bdDeTenant } from "../conectar.mjs";
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
