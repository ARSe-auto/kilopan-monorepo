#!/usr/bin/env node
// Seed del tenant C «Demo Mi Flota» [AC-FMIG-18] — specs/flota/08-diseno-miga-onboarding.md §7,
// §10 del maestro (docs/PROMPT_MAESTRO_FLOTA.md): «modo `mi_flota`, demo: 1 EV48, 1 chofer,
// empresa implícita, navegación contraída (sin tarifas, liquidación por cliente, portal ni
// facturación visibles), 1 día de encargos propios con PODs y semáforo».
//
// ALCANCE DE ESTE ARCHIVO. Lo que §10 pide de C entra COMPLETO en el nivel de datos: el EV48, el
// chofer real (invitación + aprobación en 1 toque), la empresa implícita, el día de encargos con
// sus PODs y la ficha EV que hace que el semáforo del tablero F1 tenga con qué responder.
//
// LO QUE ESTE ARCHIVO NO AFIRMA, a propósito: la «navegación contraída» a nivel de MANIFEST. El
// catálogo de `servidor/manifiesto.ts` hoy tiene un solo ítem (`modulo_vehiculos`) porque los
// módulos de tarifas/liquidación/portal/facturación todavía no tienen `lookup_key` en `features`
// —lo dice su propio comentario— así que asertar «el manifest de C no ofrece tarifas» sería
// verde vacuo. Lo que SÍ es comprobable hoy, y es la contracción de verdad en la capa de datos,
// es que C opera con la empresa IMPLÍCITA como única empresa: sin contratantes no hay portal ni
// liquidación por cliente que ofrecer. El día que esos módulos entren al catálogo, la aserción
// de navegación se agrega al test de este seed.
//
// EV48: la capacidad (90 bultos) y la batería (41.860 Wh) salen del §10. La autonomía nominal
// sale del Anexo A del maestro — «305 km CLTC ⇒ 185–245 km reales — JAMÁS planificar con el
// folleto»: el seed carga 185, el piso del rango real, que es el número con el que un operador
// planifica de verdad. Cargar los 305 del folleto sembraría en la demo exactamente el error que
// el maestro prohíbe.
import { randomUUID } from "node:crypto";
import { con } from "../conectar.mjs";
import { pasoUnoEmpresaYVertical } from "../wizard-onboarding.mjs";
import { CENTINELAS, poolDelTenant, sesionDe, sembrarActorAdmin, sembrarChofer } from "./comun.mjs";
import { crearVehiculo, editarVehiculo } from "../../../apps/flota/src/servidor/vehiculos.ts";
import { crearEncargo } from "../../../apps/flota/src/servidor/encargos.ts";
import { crearRuta, asignarEncargos, publicarRuta } from "../../../apps/flota/src/servidor/rutas.ts";
import { abrirTurno } from "../../../apps/flota/src/servidor/turnos.ts";
import { registrarLectura } from "../../../apps/flota/src/servidor/lecturas.ts";
import { aterrizarCapturas } from "../../../apps/flota/src/servidor/capturas.ts";
import { tablero } from "../../../apps/flota/src/servidor/tablero.ts";

/** RUTs de la lista congelada (`db/flota/ruts-sinteticos.mjs`, AC-FIDN-21). C vive en su PROPIA
 *  base física, así que repetir un RUT que otro tenant también usa no choca con ningún UNIQUE
 *  —todos son `(tenant_id, …)` dentro de una sola base— ni inventa identidades nuevas. */
const RUT_ACTOR_ADMIN = "11.111.111-1";
const RUT_CHOFER = "12.345.678-5";
const RUT_EMPRESA_PROPIA = "76.111.111-6";

export const CENTINELA_C = CENTINELAS.c;

/** La ficha EV48 del §10 + Anexo A. `soc` NO está acá porque no es un campo de ficha: lo mueve
 *  el trigger de la 0019 desde una lectura real, y este seed captura esa lectura. */
export const EV48 = {
  capacidad_bultos: 90,
  bateria_wh: 41860,
  autonomia_nominal_km: 185,
  soh_pct: 100,
};

/** La carga con la que arranca el día demo. Por encima de los cuatro umbrales de alerta del §0
 *  (30/20/15/10) para que la demo no nazca con un banner de energía encima. */
const SOC_DE_APERTURA = 82;

/** El día de encargos propios del §10. Tres destinos con nombre real de la operación —no
 *  «Destino 1»— y con el centinela adentro, que es lo que el barrido de huella busca. */
const PARADAS_DEL_DIA = [
  { destino: `Sucursal centro ${CENTINELAS.c}`, bultos: 12 },
  { destino: `Bodega norte ${CENTINELAS.c}`, bultos: 8 },
  { destino: `Local costanera ${CENTINELAS.c}`, bultos: 5 },
];

/**
 * Siembra el tenant C «Demo Mi Flota» [AC-FMIG-18].
 *
 * Cada pieza pasa por el servicio de servidor del AC dueño (`crearVehiculo` AC-FVEH-01,
 * `emitirInvitacion`/`aprobar` AC-FIDN-03/04, `crearEncargo`/`crearRuta`/`asignarEncargos`/
 * `publicarRuta` AC-FRUT-01/04/05, `registrarLectura` AC-FVEH-18, `aterrizarCapturas`
 * AC-FPOD-01) — un seed que escribiera las filas a mano dejaría de probar el producto y pasaría
 * a probarse a sí mismo.
 */
export async function sembrarTenantC(slug = "miflota_demo", { recrear = false } = {}) {
  const tenant = await pasoUnoEmpresaYVertical(slug, { vertical: "panaderia", modo: "mi_flota", recrear });
  const actorAdmin = await sembrarActorAdmin(tenant.bd, RUT_ACTOR_ADMIN, CENTINELA_C);
  const sesionAdmin = sesionDe(actorAdmin, "admin_tenant");
  const pool = poolDelTenant(tenant);

  try {
    // La empresa IMPLÍCITA (AC-FRUT-14): la crea el TRIGGER sobre `tenant_info` cuando quedan
    // escritos el RUT y la razón social — el propio comentario de la migración 0039 dice «en
    // producción las llenará el wizard». Escribirla a mano acá sería un segundo camino que se
    // olvidaría de actualizar el día que la regla cambie.
    await con(tenant.bd, ({ sql }) =>
      sql("update tenant_info set rut_de_la_empresa = $1, razon_social = $2", [
        RUT_EMPRESA_PROPIA,
        `Reparto Mi Flota ${CENTINELA_C}`,
      ]),
    );
    const [empresaImplicita] = await con(tenant.bd, ({ sql }) =>
      sql("select id::text as id, razon_social, implicita from empresas_cliente where implicita"),
    );
    if (!empresaImplicita) {
      throw new Error(
        "seed tenant C: modo mi_flota sin empresa implícita — el trigger de AC-FRUT-14 no la sembró.",
      );
    }

    const alta = await crearVehiculo(pool, sesionAdmin, { patente: "MFLC0001", tipo: "furgón" });
    if (alta.tipo !== "ok") throw new Error(`seed tenant C: el alta del EV48 rebotó (${alta.tipo}).`);
    const fichaEv = await editarVehiculo(pool, sesionAdmin, alta.vehiculo.id, { ...EV48 });
    if (fichaEv.tipo !== "ok") {
      throw new Error(`seed tenant C: cargar la ficha EV48 rebotó (${fichaEv.tipo}).`);
    }
    const vehiculo = fichaEv.vehiculo;

    const chofer = await sembrarChofer(tenant, pool, sesionAdmin, {
      rut: RUT_CHOFER,
      nombre: `Chofer de la demo ${CENTINELA_C}`,
    });

    const encargos = [];
    for (const parada of PARADAS_DEL_DIA) {
      const [destino] = await con(tenant.bd, ({ sql }) =>
        sql("insert into destinos (nombre) values ($1) returning id::text as id, nombre", [parada.destino]),
      );
      const encargo = await crearEncargo(pool, sesionAdmin, {
        empresaClienteId: empresaImplicita.id,
        destinoId: destino.id,
        bultos: parada.bultos,
        fechaServicio: null,
        attrs: {},
        clientUuid: randomUUID(),
      });
      if (encargo.tipo !== "ok") {
        throw new Error(`seed tenant C: el encargo de «${parada.destino}» rebotó (${encargo.tipo}).`);
      }
      encargos.push({ ...encargo.encargo, destino });
    }

    const ruta = await crearRuta(pool, sesionAdmin, {
      nombre: `Día demo ${CENTINELA_C}`,
      vehiculoId: vehiculo.id,
      fechaServicio: null,
      clientUuid: randomUUID(),
    });
    const asignacion = await asignarEncargos(pool, sesionAdmin, ruta.id, encargos.map((e) => e.id));
    if (asignacion.tipo !== "ok" || asignacion.paradas < PARADAS_DEL_DIA.length) {
      throw new Error(
        `seed tenant C: la asignación dejó ${asignacion.paradas ?? 0} paradas de ${PARADAS_DEL_DIA.length}.`,
      );
    }
    const publicacion = await publicarRuta(pool, sesionAdmin, tenant.slug, ruta.id);
    if (publicacion.tipo !== "ok") {
      throw new Error(`seed tenant C: publicar el día demo rebotó (${publicacion.tipo}).`);
    }

    // El turno con su captura de carga: sin una lectura de `soc` el semáforo del tablero F1
    // responde `sin_datos` —que no es un color, es la ausencia de respuesta (§5.2-F3)— y el §10
    // pide que la demo de C tenga semáforo.
    const sesionChofer = sesionDe(chofer, "chofer");
    const apertura = await abrirTurno(pool, sesionChofer, tenant.slug, vehiculo.id);
    if (apertura.tipo !== "ok") {
      throw new Error(`seed tenant C: abrir el turno del día demo rebotó (${apertura.tipo}).`);
    }
    const lectura = await registrarLectura(pool, sesionChofer, tenant.slug, {
      magnitud: "soc",
      valor: SOC_DE_APERTURA,
      turnoId: apertura.turno.id,
      clientUuid: randomUUID(),
      tsDispositivo: new Date(),
      tzOffsetMin: -240,
      contexto: null,
      instrumentoId: null,
      sensor: null,
    });
    if (lectura.tipo !== "ok") {
      throw new Error(`seed tenant C: la captura de carga rebotó (${lectura.tipo}).`);
    }

    const paradas = await con(tenant.bd, ({ sql }) =>
      sql(
        "select id::text as id from paradas where ruta_id = $1 and tipo = 'entrega' order by orden",
        [ruta.id],
      ),
    );
    const acuses = await aterrizarCapturas(
      pool,
      sesionChofer,
      tenant.slug,
      paradas.map((p) => ({
        clientUuid: randomUUID(),
        paradaId: p.id,
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
      })),
      null,
    );
    const rechazadas = acuses.filter((a) => !a?.aceptada).length;
    if (rechazadas > 0) {
      throw new Error(`seed tenant C: ${rechazadas} de ${paradas.length} PODs no fueron aceptados.`);
    }

    const semaforo = await tablero(pool);

    return {
      ...tenant,
      actorAdmin,
      empresaImplicita,
      vehiculo: fichaEv.vehiculo,
      chofer,
      encargos,
      ruta,
      turno: apertura.turno,
      soc: SOC_DE_APERTURA,
      paradas,
      semaforo,
      centinela: CENTINELA_C,
    };
  } finally {
    await pool.end();
  }
}

// --- CLI ---------------------------------------------------------------------------------
async function principal(argv) {
  const [orden, ...resto] = argv;
  const recrear = resto.includes("--recrear");
  const libres = resto.filter((a) => !a.startsWith("--"));
  if (orden !== "sembrar") {
    console.error("tenant-c.mjs: uso: sembrar [slug=miflota_demo] [--recrear]");
    return 2;
  }
  const r = await sembrarTenantC(libres[0] ?? "miflota_demo", { recrear });
  console.log(
    `tenant-c: ${r.bd} lista · EV48 ${r.vehiculo.patente} · ${r.paradas.length} paradas con POD · ` +
      `SOC ${r.soc}% · centinela ${r.centinela}`,
  );
  return 0;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`tenant-c: ${e.message}`);
      process.exit(1);
    });
}
