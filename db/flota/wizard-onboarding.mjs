#!/usr/bin/env node
// Paso 1 del wizard de onboarding: «empresa + vertical» [AC-FMIG-14].
//
// specs/flota/08-diseno-miga-onboarding.md §6: «1. Empresa + vertical ⇒ siembra plantilla
// completa con demo tocable. Aquí ocurre la provisión física: CREATE DATABASE … TEMPLATE
// tenant_template — segundos, dentro del wizard — y la siembra de las filas del
// vertical_template elegido (terminología, motivos, checklists, cargo_types, config_ev,
// meta_eevd — §4.4)».
//
// `provisionar()` (AC-FTEN-02, db/flota/provisionar.mjs) YA hace la mitad física: crea
// `t_<slug>` desde la plantilla y siembra la identidad del tenant. Ese mismo archivo deja
// dicho, en su propio comentario, que «el wizard de AC-FMIG-14 va a invocar provisionar() como
// su servicio de alta» — esto es esa invocación, más la mitad que faltaba: la fila de
// `vertical_template` que el paso 1 promete.
//
// CATÁLOGO DE VERTICALES EN E1: la Pregunta al dueño 10 de la spec 08 deja abierto qué
// verticales ofrece el paso 1 más allá de que el maestro (§9.1) solo nombra
// `vertical-panaderia`. Por eso `VERTICALES_DEMO` tiene HOY un solo vertical — agregar otro es
// una entrada nueva acá, cero migraciones (§2 métrica 4: activar un vertical = INSERT de filas).
//
// PASOS 2-4 (más abajo en este archivo): vehículo+chofer, paradas y primera parada completada.
// Cada paso REUSA el servicio de servidor del AC dueño del módulo — `crearVehiculo`
// (AC-FVEH-01), `emitirInvitacion`/`aprobar` (AC-FIDN-03/04), `crearEncargo`/`crearRuta`/
// `asignarEncargos`/`publicarRuta` (AC-FRUT-01/04/05), `aterrizarCapturas` (AC-FPOD-01/03) —
// nada se reimplementa: son funciones de SERVIDOR puras (`Pool` + `Sesion` de `pg`), no rutas
// Next, así que este script las invoca directo, igual que ya hacía con `provisionar()`.
//
// DATOS DE INSTANCIA (empresa cliente, destino, encargo) para la «primera ruta» navegable: la
// Pregunta al dueño 5 (cómo se DISTINGUEN y PURGAN los datos demo de los reales) sigue abierta
// y este archivo no la resuelve inventando una marca/columna nueva — eso sería decidir la
// pregunta, no construir el AC. Lo que sí construye: en modo `mi_flota` reusa la empresa
// IMPLÍCITA que el propio trigger de AC-FRUT-14 siembra (no es un dato inventado, es el mismo
// que vería un tenant real recién nacido); en modo `daas` crea una empresa contratante con un
// RUT de la lista congelada (AC-FIDN-21). El actor `admin_tenant` que ejecuta los pasos 2-3 es
// una identidad mínima sembrada por este script para poder invocar los servicios — la Pregunta
// al dueño 1 (cómo nace la credencial del PRIMER admin real) tampoco se resuelve acá.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { con, urlDe } from "./conectar.mjs";
import { provisionar } from "./provisionar.mjs";
import { crearVehiculo } from "../../apps/flota/src/servidor/vehiculos.ts";
import { emitirInvitacion } from "../../apps/flota/src/servidor/gobierno.ts";
import { aprobar } from "../../apps/flota/src/servidor/aprobacion.ts";
import { hashDeCodigo } from "../../apps/flota/src/dominio/invitaciones.ts";
import { crearEncargo } from "../../apps/flota/src/servidor/encargos.ts";
import { crearRuta, asignarEncargos, publicarRuta } from "../../apps/flota/src/servidor/rutas.ts";
import { aterrizarCapturas } from "../../apps/flota/src/servidor/capturas.ts";
import { estadoVisibleDeParada } from "../../apps/flota/src/servidor/paradas.ts";

/** RUTs de la lista congelada (AC-FIDN-21, `db/flota/ruts-sinteticos.mjs`) — este archivo
 *  provisiona su PROPIO tenant (`gate_wizard`), así que reusar índices ya declarados no choca
 *  con ninguna otra suite. */
const RUT_ACTOR_ADMIN = "11.111.111-1";
const RUT_CHOFER_DEMO = "12.345.678-5";
const RUT_EMPRESA_DEMO = "76.111.111-6";

/**
 * Un vertical es una FILA de `vertical_template`, jamás una migración (§4.9, §2 métrica 4).
 * Los valores de acá son el «demo tocable» del paso 1: suficientes para que el vertical no
 * nazca vacío (el CHECK `meta_eevd > 0` ya lo impediría) y con forma real de negocio, no
 * placeholders — `meta_eevd: 18` es la misma cifra de referencia que usan los fixtures de
 * pgTAP para «panaderia» (db/flota/pgtap/0002_verticales_grupos_y_parametros.sql).
 */
export const VERTICALES_DEMO = {
  panaderia: {
    // Forma pensada para el día que AC-FMIG-15 la conecte a `OVERRIDES_VERTICAL`
    // (packages/miga/src/terminologia.ts): `Record<term_key, {singular, plural}>`.
    terminologia: {
      parada: { singular: "reparto", plural: "repartos" },
      encargo: { singular: "pedido", plural: "pedidos" },
    },
    motivos: ["cliente_ausente", "direccion_incorrecta", "rechazo_de_carga", "local_cerrado"],
    checklists: [
      {
        titulo: "Chequeo de salida",
        items: [
          { texto: "Puertas del furgón cierran y sellan", obligatorio: true },
          { texto: "Carga asegurada, sin bultos sueltos", obligatorio: true },
          { texto: "Nivel de batería registrado", obligatorio: true },
        ],
      },
    ],
    cargo_types: ["pan_bandejas", "pan_bultos"],
    config_ev: { reserva_pct: 15 },
    meta_eevd: 18,
  },
};

export function verticalesDisponibles() {
  return Object.keys(VERTICALES_DEMO);
}

/**
 * Provisiona el tenant y siembra la fila de `vertical_template` del vertical elegido.
 *
 * Si la provisión física falla, `provisionar()` ya se deshace sola (§4.1: una base a medio
 * provisionar es peor que ninguna). Si lo que falla es la siembra del vertical, el tenant NO
 * se deshace: `provisionar()` ya lo dejó coherente y usable — le falta la fila de producto,
 * no la identidad — así que el error se reporta con el tenant vivo en vez de destruir una base
 * físicamente sana por un problema de una tabla de configuración.
 */
export async function pasoUnoEmpresaYVertical(slug, { vertical = "panaderia", modo = "mi_flota", recrear = false } = {}) {
  const plantilla = VERTICALES_DEMO[vertical];
  if (!plantilla) {
    throw new Error(
      `vertical inválido: «${vertical}». El paso 1 del wizard ofrece SOLO ` +
        `${verticalesDisponibles().join(", ")} en E1 (Pregunta al dueño 10 de ` +
        "specs/flota/08-diseno-miga-onboarding.md, todavía abierta).",
    );
  }

  const tenant = await provisionar(slug, { modo, recrear });

  try {
    await con(tenant.bd, ({ sql }) =>
      sql(
        `insert into vertical_template
           (vertical, terminologia, motivos, checklists, cargo_types, config_ev, meta_eevd)
         values ($1, $2::jsonb, $3, $4::jsonb, $5, $6::jsonb, $7)`,
        [
          vertical,
          JSON.stringify(plantilla.terminologia),
          plantilla.motivos,
          JSON.stringify(plantilla.checklists),
          plantilla.cargo_types,
          JSON.stringify(plantilla.config_ev),
          plantilla.meta_eevd,
        ],
      ),
    );
  } catch (e) {
    throw new Error(
      `${tenant.bd} quedó provisionada pero el paso 1 no pudo sembrar el vertical «${vertical}»: ` +
        `${e.message}. El tenant SIGUE VIVO (§4.1 no lo exige deshecho por esto) — reintentar la ` +
        "siembra del vertical, no volver a provisionar.",
    );
  }

  return { ...tenant, vertical };
}

/** El `Pool` con el rol de APP del tenant (`app_t_<slug>`), no el migrador: es con el que
 *  corre la app en producción, y `enActo`/`enLectura` declaran `app.current_role` sobre esta
 *  conexión (mismo patrón que `db/flota/suite-bd/orden-autoritativo-proyeccion.test.mjs`). */
function poolDelTenant(tenant) {
  return new pg.Pool({ connectionString: urlDe(tenant.bd, { usuario: tenant.rol, clave: tenant.clave }) });
}

function sesionDe(actor, rol, empresaClienteId = null) {
  return {
    dispositivoId: actor.dispositivoId,
    personaId: actor.personaId,
    usuarioId: actor.usuarioId,
    rol,
    isStandalone: true,
    storagePersisted: true,
    empresaClienteId,
  };
}

/**
 * El actor `admin_tenant` que EJECUTA los pasos 2-3, no una decisión de producto: la Pregunta
 * al dueño 1 deja abierto cómo nace la credencial del primer admin real. Identidad mínima
 * sembrada directo en la base (mismo patrón que `sembrarIdentidadDelVecino` en
 * `apps/flota/e2e/preparar-tenants.mjs`), con un `secreto_hash` que no abre nada de verdad.
 */
async function sembrarActorAdminDelWizard(bd) {
  return con(bd, async ({ sql }) => {
    const [persona] = await sql(
      "insert into personas (rut, nombre) values ($1, 'Dueña de la operación (wizard)') " +
        "returning id::text as id",
      [RUT_ACTOR_ADMIN],
    );
    const [usuario] = await sql(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [persona.id],
    );
    const [dispositivo] = await sql(
      `insert into dispositivos
         (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, 'hash-del-actor-admin-del-wizard', $2, now(), true, true)
       returning id::text as id`,
      [persona.id, usuario.id],
    );
    return { personaId: persona.id, usuarioId: usuario.id, dispositivoId: dispositivo.id };
  });
}

/** Un par ECDH P-256 REAL: `aprobar()` sella el secreto del chofer contra esta clave con el
 *  MISMO `sellar()` que usa el aparato de verdad (`dominio/secretos.ts`) — un string cualquiera
 *  ahí no simularía la aprobación, la rompería (`subtle.importKey` rechaza una SPKI inválida). */
async function clavePublicaDeAparatoDemo() {
  const par = await globalThis.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const spki = await globalThis.crypto.subtle.exportKey("spki", par.publicKey);
  return Buffer.from(spki).toString("base64");
}

/**
 * Paso 2 del wizard: vehículo (<2 min, patente+tipo) + chofer real por invitación con
 * aprobación en 1 toque [AC-FMIG-14] — §6.
 *
 * La SOLICITUD del chofer es la única parte sin servicio de servidor puro que invocar: el
 * endpoint público `/api/solicitudes` está atado a `headers()` de Next. Este paso hace lo
 * mismo que ese handler —insertar la fila `pendiente` contra el hash del código— en vez de
 * levantar un servidor Next para pegarle por HTTP.
 */
export async function pasoDosVehiculoYChofer(tenant, { patente = "DEMO01", tipoVehiculo = "furgón" } = {}) {
  const actorAdmin = await sembrarActorAdminDelWizard(tenant.bd);
  const sesionAdmin = sesionDe(actorAdmin, "admin_tenant");
  const pool = poolDelTenant(tenant);
  try {
    const altaVehiculo = await crearVehiculo(pool, sesionAdmin, { patente, tipo: tipoVehiculo });
    if (altaVehiculo.tipo !== "ok") {
      throw new Error(`paso 2 del wizard: el alta del vehículo demo rebotó (${altaVehiculo.tipo}).`);
    }

    const invitacion = await emitirInvitacion(pool, sesionAdmin, "chofer");
    const clavePublica = await clavePublicaDeAparatoDemo();
    const [solicitud] = await con(tenant.bd, ({ sql }) =>
      sql(
        `insert into solicitudes_acceso
           (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
         values ($1, $2, 'Chofer de la primera ruta (wizard)', '$argon2id$demo-chofer-del-wizard',
                 $3, 'huella-del-telefono-del-chofer-del-wizard')
         returning id::text as id`,
        [invitacion.id, RUT_CHOFER_DEMO, clavePublica],
      ),
    );

    const resultadoAprobacion = await aprobar(pool, solicitud.id, sesionAdmin.usuarioId);
    if (resultadoAprobacion.tipo !== "aprobada") {
      throw new Error(
        `paso 2 del wizard: la aprobación del chofer demo rebotó (${resultadoAprobacion.motivo}).`,
      );
    }

    return {
      ...tenant,
      actorAdmin,
      vehiculo: altaVehiculo.vehiculo,
      chofer: { usuarioId: resultadoAprobacion.usuarioId, dispositivoId: resultadoAprobacion.dispositivoId },
    };
  } finally {
    await pool.end();
  }
}

/**
 * Paso 3 del wizard: encargo mínimo (empresa + destino + bultos; `fecha_servicio` default
 * hoy) armado en una ruta y PUBLICADO [AC-FMIG-14] — §6, §3.E1.5.
 */
export async function pasoTresParadas(tenant, { bultos = 3 } = {}) {
  const sesionAdmin = sesionDe(tenant.actorAdmin, "admin_tenant");
  const pool = poolDelTenant(tenant);
  try {
    let empresa;
    if (tenant.modo === "mi_flota") {
      // La empresa IMPLÍCITA (AC-FRUT-14, `db/migraciones-flota/tenant/0039`) nace del trigger
      // sobre `tenant_info` cuando `rut_de_la_empresa`/`razon_social` quedan escritos — el
      // propio comentario de esa migración dice «en producción las llenará el wizard
      // (AC-FMIG-14)»: es ESTE paso, no una empresa demo inventada aparte.
      let [fila] = await con(tenant.bd, ({ sql }) =>
        sql("select id::text as id, razon_social from empresas_cliente where implicita"),
      );
      if (!fila) {
        await con(tenant.bd, ({ sql }) =>
          sql(
            "update tenant_info set rut_de_la_empresa = $1, razon_social = 'Mi Flota — operación del wizard'",
            [RUT_EMPRESA_DEMO],
          ),
        );
        [fila] = await con(tenant.bd, ({ sql }) =>
          sql("select id::text as id, razon_social from empresas_cliente where implicita"),
        );
      }
      if (!fila) {
        throw new Error(
          "paso 3 del wizard: modo mi_flota sin empresa implícita — el trigger de AC-FRUT-14 no la sembró.",
        );
      }
      empresa = fila;
    } else {
      const [fila] = await con(tenant.bd, ({ sql }) =>
        sql(
          `insert into empresas_cliente (rut, razon_social)
           values ($1, 'Contratante demo del wizard')
           returning id::text as id, razon_social`,
          [RUT_EMPRESA_DEMO],
        ),
      );
      empresa = fila;
    }

    const [destino] = await con(tenant.bd, ({ sql }) =>
      sql(
        "insert into destinos (nombre) values ('Primera parada demo del wizard') returning id::text as id",
      ),
    );

    const altaEncargo = await crearEncargo(pool, sesionAdmin, {
      empresaClienteId: empresa.id,
      destinoId: destino.id,
      bultos,
      fechaServicio: null,
      attrs: {},
      clientUuid: randomUUID(),
    });
    if (altaEncargo.tipo !== "ok") {
      throw new Error(`paso 3 del wizard: el alta del encargo demo rebotó (${altaEncargo.tipo}).`);
    }

    const ruta = await crearRuta(pool, sesionAdmin, {
      nombre: "Ruta demo del wizard",
      vehiculoId: tenant.vehiculo.id,
      fechaServicio: null,
      clientUuid: randomUUID(),
    });

    const asignacion = await asignarEncargos(pool, sesionAdmin, ruta.id, [altaEncargo.encargo.id]);
    if (asignacion.tipo !== "ok" || asignacion.paradas < 1) {
      throw new Error(
        `paso 3 del wizard: la asignación del encargo demo no generó parada (${asignacion.tipo}).`,
      );
    }

    const publicacion = await publicarRuta(pool, sesionAdmin, tenant.slug, ruta.id);
    if (publicacion.tipo !== "ok") {
      throw new Error(`paso 3 del wizard: publicar el día demo rebotó (${publicacion.tipo}).`);
    }

    const [parada] = await con(tenant.bd, ({ sql }) =>
      sql(
        "select id::text as id from paradas where ruta_id = $1 and tipo = 'entrega' order by orden limit 1",
        [ruta.id],
      ),
    );

    return { ...tenant, empresa, destino, encargo: altaEncargo.encargo, ruta, parada };
  } finally {
    await pool.end();
  }
}

/**
 * Paso 4 del wizard: la primera parada COMPLETADA (POD del módulo 04) [AC-FMIG-14] — §6.
 *
 * Aterriza directo por `aterrizarCapturas`, el mismo motor de sync del §4.2 (regla de oro:
 * CAPTURA 2xx siempre). No arma la parada de carga ni el sub-manifiesto (AC-FRUT-07/22): sin
 * confirmarlo, el candado degrada con flag `sin_manifiesto_confirmado` pero JAMÁS bloquea la
 * entrega (AC-FRUT-23) — es el mismo camino que recorrería un chofer real que llega a su
 * primera parada antes de que el andén confirme, y construir el andén completo no es lo que
 * este AC pide («primera parada completada», no «cadena de custodia completa»).
 */
export async function pasoCuatroPrimeraParada(tenant) {
  const pool = poolDelTenant(tenant);
  try {
    const [choferPersona] = await con(tenant.bd, ({ sql }) =>
      sql("select persona_id::text as persona_id from usuarios where id = $1", [tenant.chofer.usuarioId]),
    );
    const sesionChofer = sesionDe(
      {
        personaId: choferPersona.persona_id,
        usuarioId: tenant.chofer.usuarioId,
        dispositivoId: tenant.chofer.dispositivoId,
      },
      "chofer",
    );

    const [acuse] = await aterrizarCapturas(
      pool,
      sesionChofer,
      tenant.slug,
      [
        {
          clientUuid: randomUUID(),
          paradaId: tenant.parada.id,
          tsDispositivo: new Date(),
          tzOffsetMin: -240,
          resultado: "exito",
          metodoEntrega: null,
          motivoId: null,
          items: null,
          evidencias: [],
          turnoId: null,
          secuenciaDispositivo: null,
          supersedeDe: null,
          motivo: null,
        },
      ],
      null,
    );
    if (!acuse?.aceptada) {
      throw new Error("paso 4 del wizard: la captura de la primera entrega no fue aceptada.");
    }

    const visible = await estadoVisibleDeParada(pool, sesionChofer, tenant.parada.id);
    if (visible?.estado !== "done") {
      throw new Error(`paso 4 del wizard: la primera parada no quedó completada (estado=${visible?.estado}).`);
    }

    return { ...tenant, primeraParadaCompletada: true, resultadoDeLaPrimeraParada: visible.resultado };
  } finally {
    await pool.end();
  }
}

/**
 * El gate proxy del §2: los 4 pasos del wizard de punta a punta contra el stack local, con el
 * techo de 15 min que exige §3.E1.13 [AC-FMIG-14]. El wizard real de la UI (E2+) invocaría
 * estos mismos servicios de servidor pantalla por pantalla; este orquestador ES su equivalente
 * por script, no una simulación aparte — caso de rebote textual del AC: script >15 min o un
 * paso incompletable ⇒ gate rojo.
 */
export async function completo(slug, opts = {}) {
  const inicio = process.hrtime.bigint();
  let tenant = await pasoUnoEmpresaYVertical(slug, opts);
  tenant = await pasoDosVehiculoYChofer(tenant, opts);
  tenant = await pasoTresParadas(tenant, opts);
  tenant = await pasoCuatroPrimeraParada(tenant, opts);
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;

  const TECHO_MS = 15 * 60 * 1000;
  if (ms > TECHO_MS) {
    throw new Error(
      `wizard completo: tardó ${(ms / 1000).toFixed(1)} s, por encima del techo de 15 min del §3.E1.13.`,
    );
  }
  return { ...tenant, ms };
}

// --- CLI -------------------------------------------------------------------------------
async function principal(argv) {
  const [orden, ...resto] = argv;
  const recrear = resto.includes("--recrear");
  const verticalArg = resto.find((a) => a.startsWith("--vertical="))?.slice("--vertical=".length);
  const modoArg = resto.find((a) => a.startsWith("--modo="))?.slice("--modo=".length);
  const libres = resto.filter((a) => !a.startsWith("--"));

  if (orden === "paso1") {
    if (libres.length === 0) {
      console.error(
        "wizard-onboarding: falta el slug (uso: wizard-onboarding.mjs paso1 <slug> " +
          "[--vertical=panaderia] [--modo=mi_flota|daas] [--recrear])",
      );
      return 2;
    }
    const inicio = process.hrtime.bigint();
    const r = await pasoUnoEmpresaYVertical(libres[0], {
      vertical: verticalArg ?? "panaderia",
      modo: modoArg ?? "mi_flota",
      recrear,
    });
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    console.log(
      `wizard-onboarding paso1: ${r.bd} lista · vertical = ${r.vertical} · modo = ${r.modo} · ` +
        `${ms.toFixed(0)} ms`,
    );
    return 0;
  }

  if (orden === "completo") {
    if (libres.length === 0) {
      console.error(
        "wizard-onboarding: falta el slug (uso: wizard-onboarding.mjs completo <slug> " +
          "[--vertical=panaderia] [--modo=mi_flota|daas] [--recrear])",
      );
      return 2;
    }
    const r = await completo(libres[0], {
      vertical: verticalArg ?? "panaderia",
      modo: modoArg ?? "mi_flota",
      recrear,
    });
    console.log(
      `wizard-onboarding completo: ${r.bd} lista · vehículo ${r.vehiculo.patente} · ` +
        `parada ${r.parada.id} completada (${r.resultadoDeLaPrimeraParada}) · ${(r.ms / 1000).toFixed(1)} s`,
    );
    return 0;
  }

  console.error(
    "wizard-onboarding.mjs: uso: {paso1|completo <slug> [--vertical=] [--modo=] [--recrear]}",
  );
  return 2;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`wizard-onboarding: ${e.message}`);
      process.exit(1);
    });
}
