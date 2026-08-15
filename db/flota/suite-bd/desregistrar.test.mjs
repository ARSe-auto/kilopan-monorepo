#!/usr/bin/env node
// La baja completa y el saneo de huérfanos, probados contra el cluster real.
//
// El defecto que esto clava: con el alta persistida [AC-FPOR-01], un fixture que muere sin
// su `finally` deja fila sin base, y esa fila pone rojo el paso exportador de TODAS las
// corridas siguientes (AC-FTEN-20). El saneo la borra; y NO borra un huérfano de slug real,
// porque nombrarlo es el contrato del AC.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { con, BD_CONTROL } from "../conectar.mjs";
import { desregistrar, desregistrarComo } from "./desregistrar.mjs";

const RAIZ = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  await desregistrarComo("gate\\_hf\\_%");
});

test("desregistrar borra la fila Y sus hijas: la FK deja de bloquear la limpieza", async () => {
  await con(BD_CONTROL, async ({ sql }) => {
    const [t] = await sql(
      "insert into tenants (slug, bd) values ('gate_hf_baja', 't_gate_hf_baja') returning id::text as id",
    );
    await sql(
      `insert into agregados_tecnicos (tenant_id, ventana_inicio, ventana_fin)
       values ($1, now() - interval '5 min', now())`,
      [t.id],
    );
    // El defecto original, reproducido: con la hija puesta, el delete directo rebota.
    await assert.rejects(() => sql("delete from tenants where slug = 'gate_hf_baja'"), {
      code: "23503",
    });
  });

  await desregistrar("gate_hf_baja");

  await con(BD_CONTROL, async ({ sql }) => {
    const [{ n }] = await sql(
      "select count(*)::int as n from tenants where slug = 'gate_hf_baja'",
    );
    assert.equal(n, 0, "la fila sobrevivió a la baja");
  });
});

test("el saneo del gate borra el fixture huérfano y RESPETA al huérfano de slug real", async () => {
  await con(BD_CONTROL, async ({ sql }) => {
    await sql("delete from tenants where slug in ('gate_hf_abortado', 'zz_hf_real')");
    // El fixture que una corrida abortada dejaría: slug de prueba, base inexistente.
    await sql("insert into tenants (slug, bd) values ('gate_hf_abortado', 't_gate_hf_abortado')");
    // El huérfano REAL que el AC exige seguir nombrando: slug fuera del espacio de prueba.
    await sql("insert into tenants (slug, bd) values ('zz_hf_real', 't_zz_hf_real')");
  });

  try {
    const salida = execFileSync("node", [join(RAIZ, "db/flota/sanear-gate.mjs")], {
      encoding: "utf8",
    });
    assert.match(salida, /gate_hf_abortado/, "el fixture huérfano no fue saneado");
    assert.doesNotMatch(salida, /zz_hf_real/, "el saneo tocó un huérfano de slug real");

    await con(BD_CONTROL, async ({ sql }) => {
      const filas = await sql(
        "select slug from tenants where slug in ('gate_hf_abortado', 'zz_hf_real') order by 1",
      );
      assert.deepEqual(
        filas.map((f) => f.slug),
        ["zz_hf_real"],
        "debe borrar el fixture y dejar el real",
      );
    });
  } finally {
    await con(BD_CONTROL, ({ sql }) =>
      sql("delete from tenants where slug in ('gate_hf_abortado', 'zz_hf_real')"),
    );
  }
});
