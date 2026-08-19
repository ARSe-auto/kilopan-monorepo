#!/usr/bin/env node
// El registro MANUAL del folio del DTE sobre la liquidación cerrada [AC-FTAR-16] —
// specs/flota/06-tarifas-liquidacion-facturacion.md, §7.3, §4.6, §3.E2, art. 97 N°4 CT.
//
// La app REGISTRA lo que un emisor autorizado por el SII ya emitió afuera; jamás emite. Lo que
// esta suite ejerce es el servicio de verdad —`registrarFolioDeLiquidacion`, el mismo que llama
// `POST /api/liquidaciones/[id]/folio`— contra el cluster real y con el rol de APP del tenant
// (`app_t_<slug>`, NOSUPERUSER, sin BYPASSRLS), no con el migrador: una mutación probada con el
// dueño del esquema no prueba que la app pueda hacerla.
//
// ─── POR QUÉ ACÁ Y NO EN pgTAP ──────────────────────────────────────────────────────────────
//
// La mitad DDL de este AC (la 0072: columna, FK compuesta e índice único parcial) ya tiene su
// pgTAP en `0037_folio_y_dinero_invisible.sql`. Lo que falta probar es la MITAD DE SERVICIO, y
// esa es TypeScript: los tres rebotes 422 tipados, el «0 filas» de cada uno, y que el folio
// quede asociado a SU liquidación y no a otra. Un pgTAP no puede llamarla.
//
// ─── EL «0 FILAS» SE CUENTA CONTRA LA BASE, NO CONTRA EL VALOR DE RETORNO ───────────────────
//
// Cada rebote se aserta dos veces: el tipo que devolvió el servicio Y el conteo de
// `reference_document` antes y después. Un servicio que devolviera el rebote correcto habiendo
// dejado la fila escrita —el caso exacto que el §9.2 llama verde falso— pasaría la primera
// aserción y reprobaría la segunda. `reference_document` es tabla COMPARTIDA con custodia y su
// `UNIQUE(tipo, folio, emisor)` es global: un folio escrito de más queda quemado para siempre.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar, desalta } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";
import { poolDelTenant } from "../seeds/comun.mjs";
import {
  registrarFolioDeLiquidacion,
  liquidacionConLineas,
} from "../../../apps/flota/src/servidor/liquidaciones.ts";

const SLUG = "gate_folio_liquidacion";

let tenant;
let pool;
let migrador;
/** La sesión del operador: `enActo` solo declara `app.current_role` y `app.current_empresa`. */
let sesion;

/** Las cinco liquidaciones del fixture, resueltas en `before`. */
const id = { cerrada: "", abierta: "", pagada: "", segunda: "", tercera: "" };

async function limpiar() {
  await desalta(SLUG);
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`));
  await borrarRolDeApp(SLUG);
}

const enLaBase = (texto, params = []) => migrador.sql(texto, params);
const una = async (texto, params = []) => (await enLaBase(texto, params))[0];
const cuantosDocumentos = async () =>
  (await una("select count(*)::int as n from reference_document")).n;

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

  const empresa = (
    await una(
      "insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería del folio') returning id::text as id",
    )
  ).id;

  const nueva = async (inicio, fin) =>
    (
      await una(
        "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, $2::date, $3::date) returning id::text as id",
        [empresa, inicio, fin],
      )
    ).id;

  id.cerrada = await nueva("2026-01-01", "2026-01-07");
  id.abierta = await nueva("2026-01-08", "2026-01-14");
  id.pagada = await nueva("2026-01-15", "2026-01-21");
  id.segunda = await nueva("2026-01-22", "2026-01-28");
  id.tercera = await nueva("2026-02-01", "2026-02-07");

  // La máquina de la 0065 avanza de a una: `pagada` pasa por `cerrada` primero.
  await enLaBase("update liquidaciones set estado = 'cerrada' where id in ($1, $2, $3, $4)", [
    id.cerrada,
    id.pagada,
    id.segunda,
    id.tercera,
  ]);
  await enLaBase("update liquidaciones set estado = 'pagada' where id = $1", [id.pagada]);

  const persona = (
    await una(
      "insert into personas (rut, nombre) values ('11.111.111-1', 'Operadora que registra el folio') returning id::text as id",
    )
  ).id;
  const usuario = (
    await una("insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id", [
      persona,
    ])
  ).id;

  sesion = {
    dispositivoId: null,
    personaId: persona,
    usuarioId: usuario,
    rol: "operador",
    isStandalone: true,
    storagePersisted: true,
    empresaClienteId: null,
  };

  pool = poolDelTenant(tenant);
});

after(async () => {
  await pool?.end();
  await migrador?.cerrar();
  await limpiar();
});

const documento = (extra = {}) => ({
  tipo: "33",
  folio: "1001",
  emisor: "76.999.999-K",
  fecha: "2026-01-08",
  ...extra,
});

test("[AC-FTAR-16] el positivo antes que nada: sobre una `cerrada` el folio queda asociado a SU liquidación", async () => {
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: id.cerrada,
    ...documento(),
  });
  assert.equal(registro.tipo, "ok", `el registro rebotó: ${JSON.stringify(registro)}`);

  // Contra la BASE, no contra lo que devolvió: la fila del documento existe con sus tres datos
  // leídos del papel, y la liquidación apunta a ESA fila y no a otra.
  const doc = await una(
    "select id::text as id, tipo::text as tipo, folio, emisor, to_char(fecha, 'YYYY-MM-DD') as fecha from reference_document",
  );
  assert.deepEqual(
    { tipo: doc.tipo, folio: doc.folio, emisor: doc.emisor, fecha: doc.fecha },
    { tipo: "33", folio: "1001", emisor: "76.999.999-K", fecha: "2026-01-08" },
  );
  assert.equal(registro.reference_document_id, doc.id);

  const asociaciones = await enLaBase(
    "select id::text as id from liquidaciones where reference_document_id = $1",
    [doc.id],
  );
  assert.deepEqual(
    asociaciones.map((f) => f.id),
    [id.cerrada],
    "el folio no quedó asociado exactamente a SU liquidación",
  );

  // Y se lee desde el drill-down (§4.6, «asociación nullable al folio registrado»): sin esto el
  // folio estaría escrito pero sería invisible para quien tiene que cobrarlo.
  const vista = await liquidacionConLineas(pool, sesion, id.cerrada);
  assert.deepEqual(
    { tipo: vista.documento.tipo, folio: vista.documento.folio, emisor: vista.documento.emisor },
    { tipo: "33", folio: "1001", emisor: "76.999.999-K" },
  );
  const sinFolio = await liquidacionConLineas(pool, sesion, id.segunda);
  assert.equal(sinFolio.documento, null, "una liquidación sin folio tiene que traer `null`");
});

test("[AC-FTAR-16] sobre una `abierta` ⇒ 422 y CERO filas escritas", async () => {
  const antes = await cuantosDocumentos();
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: id.abierta,
    ...documento({ folio: "2002" }),
  });
  assert.equal(registro.tipo, "estado_no_admite_folio");
  assert.equal(registro.estado, "abierta");

  assert.equal(await cuantosDocumentos(), antes, "el rebote dejó una fila escrita en la tabla COMPARTIDA");
  const [{ n }] = await enLaBase(
    "select count(*)::int as n from liquidaciones where id = $1 and reference_document_id is not null",
    [id.abierta],
  );
  assert.equal(n, 0, "la liquidación abierta quedó con folio");
});

test("[AC-FTAR-16] sobre una `pagada` ⇒ 422 y CERO filas: el folio llega antes del pago", async () => {
  const antes = await cuantosDocumentos();
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: id.pagada,
    ...documento({ folio: "3003" }),
  });
  assert.equal(registro.tipo, "estado_no_admite_folio");
  assert.equal(registro.estado, "pagada");
  assert.equal(await cuantosDocumentos(), antes);
});

test("[AC-FTAR-16] folio duplicado ⇒ 422 y CERO filas, y la segunda liquidación sigue sin folio", async () => {
  const antes = await cuantosDocumentos();
  // El MISMO (tipo, folio, emisor) del primer test, sobre OTRA liquidación cerrada: es el
  // duplicado que el `UNIQUE(tipo, folio, emisor)` de la 0006 prohíbe. Que rebote en vez de
  // LIGARSE al documento que ya existe es el punto — ligarlo le pegaría a esta liquidación el
  // papel que ampara otra.
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: id.segunda,
    ...documento(),
  });
  assert.equal(registro.tipo, "folio_duplicado");

  assert.equal(await cuantosDocumentos(), antes, "el duplicado escribió una fila igual");
  const [{ n }] = await enLaBase(
    "select count(*)::int as n from liquidaciones where id = $1 and reference_document_id is not null",
    [id.segunda],
  );
  assert.equal(n, 0, "la liquidación se quedó con el documento de otra");

  // Y el documento original sigue amparando UNA sola liquidación: la suya.
  const [{ cuantas }] = await enLaBase(
    `select count(*)::int as cuantas from liquidaciones
      where reference_document_id = (select id from reference_document where folio = '1001')`,
  );
  assert.equal(cuantas, 1);
});

test("[AC-FTAR-16] la liquidación que ya tiene folio no lo pierde: 422 y CERO filas", async () => {
  const antes = await cuantosDocumentos();
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: id.cerrada,
    ...documento({ folio: "4004" }),
  });
  assert.equal(registro.tipo, "ya_tiene_folio");
  assert.equal(await cuantosDocumentos(), antes, "el rebote quemó un folio nuevo en la tabla compartida");

  const [{ folio }] = await enLaBase(
    `select rd.folio from liquidaciones l join reference_document rd on rd.id = l.reference_document_id
      where l.id = $1`,
    [id.cerrada],
  );
  assert.equal(folio, "1001", "el folio original se sobrescribió");
});

test("[AC-FTAR-16] la liquidación que no existe ⇒ 404 y CERO filas", async () => {
  const antes = await cuantosDocumentos();
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: crypto.randomUUID(),
    ...documento({ folio: "5005" }),
  });
  assert.equal(registro.tipo, "liquidacion_no_existe");
  assert.equal(await cuantosDocumentos(), antes);
});

test("[AC-FTAR-16] los cuatro tipos del SII (33, 39, 52, 61) se registran, y nada más", async () => {
  // El catálogo cerrado del §4.6 no vive en el servicio: es el enum `dte_tipo` de la BD, y por eso
  // se prueba contra la BD. Un tipo fuera del catálogo ni siquiera llega — el `esTipoDeDte` del
  // handler lo rebota 422 antes— pero si llegara, la base tiene que negarse igual.
  const tipos = await enLaBase(
    "select unnest(enum_range(null::dte_tipo))::text as tipo order by 1",
  );
  assert.deepEqual(
    tipos.map((t) => t.tipo).sort(),
    ["33", "39", "52", "61"],
    "el catálogo de tipos de DTE dejó de ser el del §4.6",
  );

  // Uno de los otros tres, de punta a punta sobre la última liquidación libre: el positivo del
  // primer test es un 33, y un servicio que hubiera cableado ese tipo pasaría igual sin esto.
  const registro = await registrarFolioDeLiquidacion(pool, sesion, {
    liquidacionId: id.tercera,
    tipo: "52",
    folio: "6006",
    // El MISMO emisor del 33 de más arriba, y no uno nuevo: la flota emite la factura y la guía
    // de despacho de la misma carga, así que un emisor distinto sería un fixture menos realista
    // — y el `UNIQUE(tipo, folio, emisor)` igual los separa por tipo y folio.
    emisor: "76.999.999-K",
    fecha: null,
  });
  assert.equal(registro.tipo, "ok");
  const [{ tipo, fecha }] = await enLaBase(
    `select rd.tipo::text as tipo, rd.fecha from liquidaciones l
       join reference_document rd on rd.id = l.reference_document_id where l.id = $1`,
    [id.tercera],
  );
  assert.equal(tipo, "52");
  assert.equal(fecha, null, "la fecha del documento es opcional (§4.6): la 0006 la dejó nullable");
});
