#!/usr/bin/env node
// La empresa implícita del tenant recién provisionado [AC-FPOR-17] — spec 07, §3 y §4.5.
//
// QUÉ PRUEBA Y QUÉ NO. El trigger es del módulo 03 (`crear_empresa_implicita()`,
// `db/migraciones-flota/tenant/0039_empresa_implicita.sql`, AC-FRUT-14) y acá NO se
// re-especifica: lo que se aserta es su EFECTO por el camino real del alta — `provisionar()`,
// el mismo servicio que consume el wizard (AC-FPOR-01, AC-FMIG-14). El §3 dice que en
// `mi_flota` «existe UNA empresa_cliente implícita (= la propia, creada por trigger)» y el §4.5
// lo repite sobre `empresas_cliente`: eso es una promesa sobre la base ACABADA DE PROVISIONAR,
// no sobre una base que alguien terminó de llenar a mano después.
//
// POR QUÉ ACÁ Y NO EN `centinela-11.test.mjs`. El centinela 11 (AC-FPOR-02) prueba que la
// conmutación NO PIERDE la empresa implícita, y para eso su fixture la crea a mano —
// `update tenant_info set rut_de_la_empresa = …` en su siembra. Esa mano es justamente lo que
// esta suite no puede darse: si el alta no la crea, el centinela seguiría verde y un tenant
// nuevo de producción nacería sin su empresa. Las dos mitades son distintas y ninguna cubre a
// la otra.
//
// EL CASO DAAS NO ES DECORADO. Sin él la suite no distingue «lo crea el modo `mi_flota`» de
// «lo crea el alta»: el trigger mira `tenant_info.modo`, que es la RÉPLICA de
// `control.tenants.modo` (§7.2 prohíbe cruzar bases), y hasta AC-FPOR-17 el alta escribía el
// modo SOLO en `control` — un tenant dado de alta en `daas` nacía con la réplica en su default
// `mi_flota` y se llevaba una empresa implícita que el §3 no le da.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { con, BD_CONTROL, bdDeTenant } from "../conectar.mjs";
import { provisionar, desalta } from "../provisionar.mjs";

/** La empresa dueña de la cuenta: RUT de persona jurídica de la lista congelada (AC-FIDN-21). */
const RUT_PROPIO = "76.111.111-6";
const RAZON_PROPIA = "Transportes de la propia flota";

const MI_FLOTA = "gate_fpor17_mi_flota";
const DAAS = "gate_fpor17_daas";

async function borrar(slug) {
  // Igual que el resto de la suite: la fila de `control.tenants` sobrevive al DROP DATABASE y
  // el job exportador la reportaría huérfana en la corrida siguiente.
  await desalta(slug);
  await con("postgres", ({ sql }) =>
    sql(`drop database if exists ${bdDeTenant(slug)} with (force)`),
  );
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
});

after(async () => {
  await borrar(MI_FLOTA);
  await borrar(DAAS);
});

test("[AC-FPOR-17] un tenant recién provisionado en `mi_flota` tiene EXACTAMENTE UNA empresa_cliente: la propia", async () => {
  const t = await provisionar(MI_FLOTA, {
    recrear: true,
    modo: "mi_flota",
    rutDeLaEmpresa: RUT_PROPIO,
    razonSocial: RAZON_PROPIA,
  });

  await con(t.bd, async ({ sql }) => {
    const filas = await sql(
      "select tenant_id::text as tenant_id, rut, razon_social, implicita, activa from empresas_cliente",
    );
    assert.equal(
      filas.length,
      1,
      `el alta dejó ${filas.length} empresas_cliente: el §3 promete UNA, la propia`,
    );
    assert.deepEqual(filas[0], {
      tenant_id: t.id,
      rut: RUT_PROPIO,
      razon_social: RAZON_PROPIA,
      implicita: true,
      activa: true,
    });

    // «La propia» no es una convención sobre el RUT: la fila sale de la identidad que el alta
    // dejó en `tenant_info`, y el modo de la réplica es el que se eligió (§7.2).
    const [info] = await sql(
      "select modo, rut_de_la_empresa, razon_social from tenant_info",
    );
    assert.deepEqual(info, {
      modo: "mi_flota",
      rut_de_la_empresa: RUT_PROPIO,
      razon_social: RAZON_PROPIA,
    });
  });
});

test("[AC-FPOR-17] «EXACTAMENTE UNA» lo sostiene la BD: una segunda implícita rebota", async () => {
  // El trigger es idempotente, pero el conteo no puede depender de que cada camino de escritura
  // se acuerde de mirar antes: el índice parcial `empresas_cliente_una_implicita` (0039) es el
  // que hace imposible la segunda, y sin ejercerlo «exactamente una» sería una coincidencia.
  await assert.rejects(
    () =>
      con(bdDeTenant(MI_FLOTA), ({ sql }) =>
        sql(
          "insert into empresas_cliente (rut, razon_social, implicita) values ($1, $2, true)",
          ["77.222.222-K", "La segunda propia, que no existe"],
        ),
      ),
    /empresas_cliente_una_implicita/,
  );

  const [{ n }] = await con(bdDeTenant(MI_FLOTA), ({ sql }) =>
    sql("select count(*)::int as n from empresas_cliente"),
  );
  assert.equal(n, 1, "el rebote no puede dejar una segunda empresa a medias");
});

test("[AC-FPOR-17] la implícita es efecto del MODO: el mismo alta en `daas` no crea ninguna", async () => {
  const t = await provisionar(DAAS, {
    recrear: true,
    modo: "daas",
    rutDeLaEmpresa: RUT_PROPIO,
    razonSocial: RAZON_PROPIA,
  });

  const [{ modo }] = await con(BD_CONTROL, ({ sql }) =>
    sql("select modo::text as modo from tenants where slug = $1", [t.slug]),
  );
  assert.equal(modo, "daas");

  await con(t.bd, async ({ sql }) => {
    const [{ replica }] = await sql("select modo as replica from tenant_info");
    assert.equal(
      replica,
      "daas",
      "la réplica del tenant se quedó en su default: el trigger leería un modo que no es el del tenant",
    );
    const [{ n }] = await sql("select count(*)::int as n from empresas_cliente");
    assert.equal(n, 0, "en `daas` las contratantes son 1..N y las da de alta el operador (§3)");
  });
});

test("[AC-FPOR-17] identidad a medias: el alta rebota antes de tocar el cluster", async () => {
  // Con una sola de las dos columnas el trigger no crea nada y NO rebota (a propósito, 0039):
  // el alta terminaría en verde y el tenant quedaría sin su empresa implícita para siempre,
  // que es exactamente el silencio que este AC viene a cerrar.
  await assert.rejects(
    () => provisionar("gate_fpor17_a_medias", { recrear: true, rutDeLaEmpresa: RUT_PROPIO }),
    /identidad incompleta/,
  );
  await assert.rejects(
    () => provisionar("gate_fpor17_a_medias", { recrear: true, razonSocial: RAZON_PROPIA }),
    /identidad incompleta/,
  );

  const vivas = await con("postgres", ({ sql }) =>
    sql("select 1 from pg_database where datname = $1", [bdDeTenant("gate_fpor17_a_medias")]),
  );
  assert.equal(vivas.length, 0, "el rebote de la identidad no puede dejar una base en pie");
});
