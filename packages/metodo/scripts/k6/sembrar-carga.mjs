#!/usr/bin/env node
// sembrar-carga.mjs — provisiona el tenant de laboratorio del k6 «ráfaga matinal» y siembra la
// receta de `dataset-sintetico.generado.json` como filas REALES [AC-FPOD-15] — §0 Capacidad.
//
// Solo esta mitad necesita un cluster vivo (la receta en sí es pura, ver
// `generar-dataset-sintetico.mjs`). Por eso vive en un archivo aparte: el gate RÁPIDO importa
// el generador sin arrastrar `pg` ni un `provisionar()` que exige Postgres 18 en 127.0.0.1:54331.
//
// Un vehículo-turno-ruta-parada-dispositivo POR dispositivo sintético — no una parada
// compartida — porque el §0 mide "N=2.000 bootstraps de snapshot" y "5.000 usuarios
// concurrentes por célula": el bootstrap real recorre paradas de UNA ruta (six queries,
// `apps/flota/src/app/entrega/page.tsx`), así que 2.000 bootstraps sobre la MISMA parada no
// ejercería el volumen de filas que el §0 pide simular (2.000 turnos abiertos, 2.000 rutas
// vivas) — mediría el caché del planificador de Postgres, no la capacidad real.
import { provisionar } from "../../../../db/flota/provisionar.mjs";
import { con, bdDeTenant, BD_CONTROL } from "../../../../db/flota/conectar.mjs";
import { borrarRolDeApp } from "../../../../db/flota/rol-app.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SLUG_LABORATORIO = "k6_rafaga_matinal";

function hashDeSecreto(secreto) {
  return createHash("sha256").update(secreto, "utf8").digest("hex");
}

/**
 * Siembra `dataset.dispositivos` en el tenant `slug`, en lotes por INSERT masivo (`unnest`) y
 * no fila a fila: con N=2.000 la diferencia es minutos vs segundos, y el nightly ya tiene
 * bastante trabajo real que medir sin gastarlo en su propio seed.
 *
 * Devuelve el manifiesto de EJECUCIÓN (uuids reales + secreto en claro) que el k6 necesita
 * para pegarle al servidor — NUNCA comiteado: nace y muere con cada corrida del nightly.
 */
export async function sembrarCarga(slug, dataset, { recrear = true } = {}) {
  await provisionar(slug, { recrear });
  const bd = bdDeTenant(slug);

  const resultado = await con(bd, async ({ sql }) => {
    const [empresa] = await sql(
      `insert into empresas_cliente (rut, razon_social) values ('11.111.111-1', 'k6 ráfaga matinal — laboratorio')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
    );
    const [destino] = await sql(
      "insert into destinos (nombre) values ('Destino sintético k6') returning id::text as id",
    );
    const [config] = await sql(
      `insert into config_version (motivo, snapshot) values ('k6 ráfaga matinal (AC-FPOD-15)', '{}'::jsonb)
       returning id::text as id`,
    );

    const n = dataset.dispositivos.length;
    const ruts = dataset.dispositivos.map((d) => d.rut);
    const patentes = dataset.dispositivos.map((d) => d.patente);
    const secretoHashes = dataset.dispositivos.map((d) => hashDeSecreto(d.secreto));
    const nombres = dataset.dispositivos.map((d) => `Conductor sintético ${d.indice}`);

    const personas = await sql(
      `insert into personas (rut, nombre)
       select * from unnest($1::text[], $2::text[])
       returning id::text as id`,
      [ruts, nombres],
    );
    const personaIds = personas.map((p) => p.id);

    const usuarios = await sql(
      `insert into usuarios (persona_id, rol)
       select persona_id, 'chofer' from unnest($1::uuid[]) as t(persona_id)
       returning id::text as id, persona_id::text as persona_id`,
      [personaIds],
    );
    const usuarioIdDePersona = new Map(usuarios.map((u) => [u.persona_id, u.id]));

    await sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_en, is_standalone, storage_persisted)
       select 'personal', persona_id, secreto_hash, now(), true, true
       from unnest($1::uuid[], $2::text[]) as t(persona_id, secreto_hash)`,
      [personaIds, secretoHashes],
    );

    const vehiculos = await sql(
      `insert into vehiculos (patente, tipo)
       select patente, 'furgon' from unnest($1::text[]) as t(patente)
       returning id::text as id, patente`,
      [patentes],
    );
    const vehiculoIdDePatente = new Map(vehiculos.map((v) => [v.patente, v.id]));
    const vehiculoIds = dataset.dispositivos.map((d) => vehiculoIdDePatente.get(d.patente));

    const rutas = await sql(
      `insert into rutas (nombre, vehiculo_id, publicada_en, version)
       select 'Ruta k6 ' || vehiculo_id, vehiculo_id, now(), 1
       from unnest($1::uuid[]) as t(vehiculo_id)
       returning id::text as id, vehiculo_id::text as vehiculo_id`,
      [vehiculoIds],
    );
    const rutaIdDeVehiculo = new Map(rutas.map((r) => [r.vehiculo_id, r.id]));
    const rutaIds = vehiculoIds.map((v) => rutaIdDeVehiculo.get(v));

    const paradas = await sql(
      `insert into paradas (ruta_id, tipo, orden, destino_id)
       select ruta_id, 'entrega', 1, $2
       from unnest($1::uuid[]) as t(ruta_id)
       returning id::text as id, ruta_id::text as ruta_id`,
      [rutaIds, destino.id],
    );
    const paradaIdDeRuta = new Map(paradas.map((p) => [p.ruta_id, p.id]));

    await sql(
      `insert into turnos (vehiculo_id, config_version_id, estado, abierto_en)
       select vehiculo_id, $2, 'abierto', now()
       from unnest($1::uuid[]) as t(vehiculo_id)`,
      [vehiculoIds, config.id],
    );

    const manifiesto = dataset.dispositivos.map((d, i) => ({
      indice: d.indice,
      secreto: d.secreto,
      paradaId: paradaIdDeRuta.get(rutaIdDeVehiculo.get(vehiculoIdDePatente.get(d.patente))),
    }));

    return { slug, bd, empresaId: empresa.id, destinoId: destino.id, configVersionId: config.id, manifiesto };
  });

  // El ruteo por subdominio SOLO conoce lo que está en `control.tenants` (§4.1,
  // `apps/flota/src/servidor/ruteo.ts::resolverHost`) — no basta con que `t_<slug>` exista, el
  // servidor real (el que golpea el k6) tiene que poder resolver `<slug>.<dominio>` hasta esa
  // BD. Sin esta fila, el bootstrap y el sync del k6 devolverían 404 de subdominio desconocido
  // y el pipeline mediría el ruteo, no la capacidad (§0). Mismo patrón que
  // `apps/flota/e2e/preparar-tenants.mjs`. `estado` queda en su default ('activo'): el
  // laboratorio nace operativo.
  await con(BD_CONTROL, ({ sql }) =>
    sql(
      `insert into tenants (slug, bd) values ($1, $2)
       on conflict (slug) do update set bd = excluded.bd, estado = 'activo'`,
      [slug, bd],
    ),
  );

  return resultado;
}

/** Deja SOLO la identidad del tenant (`provisionar` con `recrear:true` la vacía igual); esto
 *  además borra el rol de app y la fila de `control.tenants` que registra el sembrado (arriba),
 *  que `provisionar` no toca. Simétrico a `preparar-tenants.mjs`. */
export async function limpiarLaboratorio(slug = SLUG_LABORATORIO) {
  await con(BD_CONTROL, ({ sql }) => sql("delete from tenants where slug = $1", [slug]));
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(slug)} with (force)`));
  await borrarRolDeApp(slug);
}

function esModuloPrincipal() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (esModuloPrincipal()) {
  // `limpiar` es el otro extremo del ciclo que `rafaga-matinal.sh` orquesta: sembrar antes del
  // k6, limpiar en su `trap` de salida, pase lo que pase con la corrida (AC-FPOD-15).
  if (process.argv[2] === "limpiar") {
    await limpiarLaboratorio();
    console.log(`sembrar-carga: laboratorio ${SLUG_LABORATORIO} limpiado`);
  } else {
    const rutaDataset = new URL("./dataset-sintetico.generado.json", import.meta.url).pathname;
    const dataset = JSON.parse(readFileSync(rutaDataset, "utf8"));
    const rutaManifiesto =
      process.env.K6_MANIFIESTO_PATH ?? join(tmpdir(), `k6-flota-manifiesto-${SLUG_LABORATORIO}.json`);

    const resultado = await sembrarCarga(SLUG_LABORATORIO, dataset);
    writeFileSync(rutaManifiesto, JSON.stringify(resultado.manifiesto));
    console.log(
      `sembrar-carga: ${resultado.manifiesto.length} dispositivos sembrados en ${resultado.bd} · manifiesto en ${rutaManifiesto}`,
    );
  }
}
