#!/usr/bin/env node
// `sembrar-carga.mjs`/`limpiarLaboratorio` contra el cluster real [AC-FPOD-15] — §0 Capacidad.
//
// La receta (`generar-dataset-sintetico.mjs`) y su sincronía con `CAPACIDAD` ya se prueban
// SIN base de datos en `packages/metodo/scripts/k6/parametrizacion.test.mjs` (corre en el gate
// rápido). Esta suite es la mitad que SÍ necesita un Postgres 18 real: que la siembra deje
// filas de verdad (persona/dispositivo/vehículo/ruta/parada/turno abierto, una cadena POR
// dispositivo — no una parada compartida, ver el comentario de `sembrar-carga.mjs`), que el
// `secreto_hash` sembrado sea el MISMO algoritmo que valida `/api/sync/capturas`
// (`apps/flota/src/dominio/secretos.ts::hashDeSecreto`, sha256 hex plano) y que el laboratorio
// quede REGISTRADO en `control.tenants` — sin esa fila el ruteo por subdominio
// (`apps/flota/src/servidor/ruteo.ts::resolverHost`) da 404 y el k6 mediría el ruteo, no la
// capacidad. Corre con `--full` (db/flota/gate.sh la recoge por el glob `suite-bd/*.test.mjs`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { con, BD_CONTROL, bdDeTenant } from "../conectar.mjs";
import { migrar } from "../migrar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { sembrarCarga, limpiarLaboratorio } from "../../../packages/metodo/scripts/k6/sembrar-carga.mjs";
import { generarDataset } from "../../../packages/metodo/scripts/k6/generar-dataset-sintetico.mjs";

// Slug PROPIO de la suite, distinto de `SLUG_LABORATORIO` («k6_rafaga_matinal», el que usa el
// nightly de verdad): dos corridas —la del gate y la del pipeline nightly— no se pisan.
const SLUG = "gate_rafaga_matinal";
const BD = bdDeTenant(SLUG);
// N chico: lo que esta suite prueba es que la siembra aterriza filas reales y coherentes, no
// el volumen del §0 (eso lo mide el k6 de verdad, nightly, contra los N=2.000 completos).
const N = 15;

function hashDeSecreto(secreto) {
  return createHash("sha256").update(secreto, "utf8").digest("hex");
}

async function limpiarDeSobra() {
  await con(BD_CONTROL, ({ sql }) => sql("delete from tenants where slug = $1", [SLUG]));
  await con("postgres", ({ sql }) => sql(`drop database if exists ${BD} with (force)`));
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
  await limpiarDeSobra();
});

after(limpiarDeSobra);

test("[AC-FPOD-15] sembrarCarga: N filas reales, una cadena vehículo-turno-ruta-parada POR dispositivo", async () => {
  const dataset = generarDataset(N);
  const resultado = await sembrarCarga(SLUG, dataset, { recrear: true });

  assert.equal(resultado.slug, SLUG);
  assert.equal(resultado.bd, BD);
  assert.equal(resultado.manifiesto.length, N, "el manifiesto no trae un dispositivo por fila del dataset");

  await con(BD, async ({ sql }) => {
    const [{ n: personas }] = await sql("select count(*)::int as n from personas");
    const [{ n: dispositivos }] = await sql("select count(*)::int as n from dispositivos");
    const [{ n: vehiculos }] = await sql("select count(*)::int as n from vehiculos");
    const [{ n: rutas }] = await sql("select count(*)::int as n from rutas");
    const [{ n: paradas }] = await sql("select count(*)::int as n from paradas");
    const [{ n: turnosAbiertos }] = await sql("select count(*)::int as n from turnos where estado = 'abierto'");
    assert.equal(personas, N);
    assert.equal(dispositivos, N);
    assert.equal(vehiculos, N);
    assert.equal(rutas, N);
    assert.equal(paradas, N, "una parada por dispositivo — no una compartida (ver sembrar-carga.mjs)");
    assert.equal(turnosAbiertos, N, "el §0 mide N bootstraps de snapshot: hace falta N turnos abiertos");

    // El secreto viaja en claro SOLO en el manifiesto (nunca en la BD) y el hash sembrado tiene
    // que ser el MISMO algoritmo que `apps/flota/src/dominio/secretos.ts::hashDeSecreto` usa
    // para autenticar el POST real — si difiriera, el k6 mediría 401 en vez de capacidad.
    const entrada = resultado.manifiesto[0];
    const [{ secreto_hash: hashSembrado }] = await sql(
      `select d.secreto_hash from dispositivos d
         join personas p on p.id = d.persona_id
        where p.rut = $1`,
      [dataset.dispositivos[0].rut],
    );
    assert.equal(hashSembrado, hashDeSecreto(entrada.secreto));

    // La parada del manifiesto es una fila REAL, colgada de la ruta del vehículo con turno
    // abierto — la misma cadena que recorre el bootstrap real (apps/flota/src/app/entrega).
    const [parada] = await sql(
      `select p.id::text as id, r.vehiculo_id::text as vehiculo_id, t.estado
         from paradas p
         join rutas r on r.id = p.ruta_id
         join turnos t on t.vehiculo_id = r.vehiculo_id
        where p.id = $1`,
      [entrada.paradaId],
    );
    assert.ok(parada, "el paradaId del manifiesto no resuelve a una parada real");
    assert.equal(parada.estado, "abierto");
  });
});

test("[AC-FPOD-15] el laboratorio queda registrado en control.tenants — si no, el ruteo por subdominio da 404", async () => {
  await con(BD_CONTROL, async ({ sql }) => {
    const filas = await sql("select bd, estado from tenants where slug = $1", [SLUG]);
    assert.equal(filas.length, 1, "sembrarCarga tiene que dejar EXACTAMENTE una fila en control.tenants");
    assert.deepEqual(filas[0], { bd: BD, estado: "activo" });
  });
});

test("[AC-FPOD-15] limpiarLaboratorio borra la BD del tenant y su fila de control.tenants", async () => {
  await limpiarLaboratorio(SLUG);

  await con(BD_CONTROL, async ({ sql }) => {
    const filas = await sql("select 1 from tenants where slug = $1", [SLUG]);
    assert.equal(filas.length, 0, "la limpieza dejó la fila de control.tenants viva");
  });
  await con("postgres", async ({ sql }) => {
    const filas = await sql("select 1 from pg_database where datname = $1", [BD]);
    assert.equal(filas.length, 0, "la limpieza dejó la BD del laboratorio viva");
  });
});
