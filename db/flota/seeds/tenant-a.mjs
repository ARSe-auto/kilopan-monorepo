#!/usr/bin/env node
// Seed del tenant A «e-auto DaaS» [AC-FMIG-25] — specs/flota/08-diseno-miga-onboarding.md §7 y
// §10 del maestro (docs/PROMPT_MAESTRO_FLOTA.md): el tenant grande del seed, el que tiene que
// tener cada cosa que un operador DaaS ve un lunes cualquiera — 3 EV48, los cinco roles del §5.4
// más el dueño, 3 contratantes con sus conceptos de tarifa, 25 destinos, una semana de agenda
// con las ventanas de recarga AC nocturna, la ruta del día consolidada de las 3 empresas, las
// cuatro salidas que no son la entrega feliz (no-entrega, parcial, devolución, descuadre) y las
// liquidaciones semanales en sus tres estados.
//
// Mitad partida de AC-FMIG-18, que cerró sobre B, C y el oráculo de fila cruzada.
//
// ─── LO QUE ESTE ARCHIVO NO SIEMBRA, Y POR QUÉ ────────────────────────────────────────
//
// `otd_comprometido_pct` de la farmacia (§4.5, §3.E1.11) NO se siembra: la columna NO EXISTE en
// ninguna migración de `db/migraciones-flota/tenant/` — la declara la spec 06 como AC-FTAR-13,
// todavía abierto — y el motor JAMÁS crea ni edita migraciones (AGENTS.md). Sembrarla sería
// inventar esquema; omitirla en silencio sería esconder que la tarjeta SLA del camino dorado de
// A no tiene con qué encenderse. Queda declarado acá, en `TARIFAS_POR_EMPRESA` y en el texto del
// AC: la farmacia lleva su concepto de bloque y su SLA espera una sesión supervisada de esquema.
//
// EV48: capacidad (90 bultos) y batería (41.860 Wh) salen del §10. La autonomía nominal sale del
// Anexo A — «305 km CLTC ⇒ 185–245 km reales — JAMÁS planificar con el folleto»: se carga 185,
// el PISO del rango real, que es el número con el que un operador planifica de verdad.
//
// Cada pieza pasa por el servicio de servidor del AC dueño (`crearVehiculo` AC-FVEH-01,
// `emitirInvitacion`/`aprobar` AC-FIDN-03/04, `agendarBloque` AC-FVEH-02, `crearEncargo`/
// `crearRuta`/`asignarEncargos`/`publicarRuta` AC-FRUT-01/04/05, `abrirTurno` AC-FVEH-17,
// `registrarLectura` AC-FVEH-18, `aterrizarCapturas` AC-FPOD-01, `cerrarRuta` AC-FRUT-11/21) —
// un seed que escribiera las filas a mano dejaría de probar el producto y pasaría a probarse a
// sí mismo. Las tres piezas que HOY no tienen servicio de servidor (tarifas, liquidaciones y la
// disputa por línea) se escriben con el SQL que la BD ya gobierna: `devengar_entrega()` es la
// única función que crea líneas (§7.5) y `disputar_linea()` la única que las disputa, así que
// invocarlas es usar el producto, no rodearlo.
import { randomUUID } from "node:crypto";
import { con } from "../conectar.mjs";
import { pasoUnoEmpresaYVertical } from "../wizard-onboarding.mjs";
import { CENTINELAS, poolDelTenant, sesionDe, sembrarActorAdmin, sembrarChofer } from "./comun.mjs";
import { crearVehiculo, editarVehiculo } from "../../../apps/flota/src/servidor/vehiculos.ts";
import { agendarBloque } from "../../../apps/flota/src/servidor/agenda.ts";
import { crearEncargo } from "../../../apps/flota/src/servidor/encargos.ts";
import { crearRuta, asignarEncargos, publicarRuta } from "../../../apps/flota/src/servidor/rutas.ts";
import { abrirTurno } from "../../../apps/flota/src/servidor/turnos.ts";
import { registrarLectura } from "../../../apps/flota/src/servidor/lecturas.ts";
import { aterrizarCapturas } from "../../../apps/flota/src/servidor/capturas.ts";
import { cerrarRuta } from "../../../apps/flota/src/servidor/cierres.ts";
import { sembrarMotivos } from "../../../apps/flota/src/servidor/motivos.ts";

export const CENTINELA_A = CENTINELAS.a;

/** RUTs de la lista congelada (`db/flota/ruts-sinteticos.mjs`, AC-FIDN-21). A vive en su PROPIA
 *  base física, así que repetir un RUT que otro tenant también usa no choca con ningún UNIQUE
 *  —todos son `(tenant_id, …)` dentro de una sola base— ni inventa identidades nuevas. */
const RUT_ACTOR_ADMIN = "11.111.111-1";

/** Los CINCO roles invitables del §5.4, uno por persona: el §10 pide 6 usuarios y el sexto es la
 *  dueña (`admin_tenant`), que no se invita — se transfiere con passkey (AC-FIDN-13). */
const EQUIPO = [
  { rol: "operador", rut: "12.345.678-5", nombre: "Operadora de la torre" },
  { rol: "chofer", rut: "6.666.666-2", nombre: "Chofer de la mañana" },
  { rol: "chofer", rut: "8.765.432-K", nombre: "Chofer de la tarde" },
  { rol: "responsable_carga", rut: "4.444.444-5", nombre: "Responsable del andén" },
  { rol: "responsable_tecnico", rut: "3.333.333-1", nombre: "Responsable técnico de flota" },
];

/**
 * Las 3 empresas contratantes del §10 con su CONCEPTO de tarifa, del catálogo cerrado de 5
 * (`tarifas_concepto_catalogo_cerrado`, migración 0061).
 *
 * `otd` queda documentado y NO se escribe: ver el bloque de cabecera. El día que AC-FTAR-13
 * cree la columna, el seed la carga desde acá sin tocar nada más.
 */
const EMPRESAS = [
  {
    clave: "farmacia",
    rut: "76.111.111-6",
    razonSocial: "Farmacias del Centro",
    concepto: "por_bloque_horas",
    precioClp: 45000,
    /** §10: «farmacia con bloque $45.000 y `otd_comprometido_pct=95`». BLOQUEADO por esquema. */
    otdComprometidoPct: 95,
    cliente: { rut: "2.222.222-8", nombre: "Contraparte de la farmacia" },
  },
  {
    clave: "distribuidora",
    rut: "77.222.222-K",
    razonSocial: "Distribuidora Andes",
    concepto: "por_entrega",
    precioClp: 3500,
    otdComprometidoPct: null,
    cliente: { rut: "1.111.112-2", nombre: "Contraparte de la distribuidora" },
  },
  {
    clave: "minimarket",
    rut: "76.543.219-7",
    razonSocial: "Cadena Mini Market Sur",
    concepto: "por_bulto",
    precioClp: 1200,
    otdComprometidoPct: null,
    cliente: { rut: "9.876.543-3", nombre: "Contraparte del minimarket" },
  },
];

/** La ficha EV48 del §10 + Anexo A, igual que en el tenant C. */
export const EV48 = {
  capacidad_bultos: 90,
  bateria_wh: 41860,
  autonomia_nominal_km: 185,
  soh_pct: 100,
};

const PATENTES_EV48 = ["EAUT0001", "EAUT0002", "EAUT0003"];

/** Carga de apertura por encima de los cuatro umbrales de alerta del §0 (30/20/15/10). */
const SOC_DE_APERTURA = 78;

/** Los 25 destinos es-CL del §10: nombre de operación real —no «Destino 1»— con su comuna de
 *  la Región Metropolitana, que es la que `modificadores_de_entrega()` mira para la zona. El
 *  centinela va en el nombre porque `destinos.nombre` es la columna de texto más inocente que
 *  hay: si el barrido de huella la ve, ve cualquier cosa. */
const DESTINOS = [
  { nombre: "Farmacia Providencia 1220", comuna: "Providencia" },
  { nombre: "Farmacia Manuel Montt 890", comuna: "Providencia" },
  { nombre: "Farmacia Irarrázaval 3400", comuna: "Ñuñoa" },
  { nombre: "Farmacia Plaza Egaña", comuna: "La Reina" },
  { nombre: "Farmacia Vitacura 6100", comuna: "Vitacura" },
  { nombre: "Farmacia Apoquindo 4500", comuna: "Las Condes" },
  { nombre: "Farmacia Gran Avenida 5200", comuna: "San Miguel" },
  { nombre: "Bodega Distribuidora Quilicura", comuna: "Quilicura" },
  { nombre: "Bodega Distribuidora Pudahuel", comuna: "Pudahuel" },
  { nombre: "Centro de acopio Renca", comuna: "Renca" },
  { nombre: "Centro de acopio Maipú", comuna: "Maipú" },
  { nombre: "Sucursal Estación Central", comuna: "Estación Central" },
  { nombre: "Sucursal Independencia", comuna: "Independencia" },
  { nombre: "Sucursal Recoleta", comuna: "Recoleta" },
  { nombre: "Minimarket San Joaquín", comuna: "San Joaquín" },
  { nombre: "Minimarket La Florida", comuna: "La Florida" },
  { nombre: "Minimarket Puente Alto", comuna: "Puente Alto" },
  { nombre: "Minimarket Peñalolén", comuna: "Peñalolén" },
  { nombre: "Minimarket Macul", comuna: "Macul" },
  { nombre: "Minimarket Cerrillos", comuna: "Cerrillos" },
  { nombre: "Minimarket Lo Espejo", comuna: "Lo Espejo" },
  { nombre: "Local Barrio Italia", comuna: "Providencia" },
  { nombre: "Local Barrio Lastarria", comuna: "Santiago" },
  { nombre: "Local Barrio Yungay", comuna: "Santiago" },
  { nombre: "Local Barrio Franklin", comuna: "Santiago" },
];

/**
 * La ruta del día CONSOLIDADA: 9 encargos, 3 por empresa, en 9 destinos DISTINTOS.
 *
 * Distintos y no repetidos porque `paradas_una_entrega_por_destino` admite UNA sola parada
 * `entrega` por destino dentro de una ruta — dos encargos al mismo local en el mismo día son un
 * caso real, pero es el de AC-FRUT-04 y no el que este seed necesita.
 *
 * `resultado` es lo que el chofer captura en F4: el §10 pide que el día tenga 1 no-entrega y 1
 * parcial además de las entregas felices, así que están acá y no en un caso aparte — el día de
 * A no es un día perfecto, es un día real.
 */
const ENCARGOS_DEL_DIA = [
  { empresa: "farmacia", destino: 0, bultos: 6, resultado: "exito" },
  { empresa: "farmacia", destino: 1, bultos: 4, resultado: "exito" },
  { empresa: "farmacia", destino: 2, bultos: 5, resultado: "fallo" },
  { empresa: "distribuidora", destino: 7, bultos: 12, resultado: "exito" },
  { empresa: "distribuidora", destino: 8, bultos: 9, resultado: "exito" },
  { empresa: "distribuidora", destino: 9, bultos: 7, resultado: "exito" },
  { empresa: "minimarket", destino: 14, bultos: 8, resultado: "exito" },
  { empresa: "minimarket", destino: 15, bultos: 6, resultado: "exito" },
  { empresa: "minimarket", destino: 16, bultos: 10, resultado: "parcial" },
];

/** La semana de agenda del §10: 7 noches de recarga AC por vehículo. Ancla fija —un lunes— para
 *  que la ventana no dependa del día en que corra el seed: la agenda es un PLAN, y un plan que
 *  cambia de forma según cuándo se siembra no se puede asertar. */
const LUNES_DE_LA_SEMANA = "2026-03-02";

/** Recarga AC nocturna (§0): entra a las 23:00 y sale a las 05:00 del día siguiente, con el
 *  offset de Chile continental en horario de verano (UTC-3 en marzo). 6 h de AC lenta es la
 *  ventana que el Anexo A da para dejar un EV48 lleno sin castigar la batería. */
const RECARGA_NOCTURNA = { entraHora: 23, saleHora: 5, offsetHoras: 3 };

/** Una fecha UTC a partir del día local chileno y la hora local, sin depender del TZ del proceso
 *  que corre el seed: el mismo criterio que `offsetChileMin()` en `gobierno.ts`. */
function enChile(diaIso, hora) {
  return new Date(`${diaIso}T${String(hora).padStart(2, "0")}:00:00-0${RECARGA_NOCTURNA.offsetHoras}:00`);
}

/** El día ISO `n` días después de `diaIso`. Aritmética sobre el mediodía UTC para que ningún
 *  cambio de horario de verano corra el día de la agenda. */
function masDias(diaIso, n) {
  const d = new Date(`${diaIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** El lunes y el domingo de la semana que contiene a `fecha`, en ISO — el período semanal de las
 *  liquidaciones del §10. */
function semanaDe(fecha) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const desdeElLunes = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - desdeElLunes);
  const inicio = d.toISOString().slice(0, 10);
  return { inicio, fin: masDias(inicio, 6) };
}

/**
 * El folio de la factura YA EMITIDA que ampara la liquidación cerrada.
 *
 * Es un dato de TERCERO que la app REGISTRA, jamás genera: el art. 97 N°4 del Código Tributario
 * hace de generar folios un delito, y por eso el número entra como `reference_document` —la
 * misma tabla donde `asociarDocumento()` (AC-FRUT-09) deja los DTE que el andén teclea— y no
 * como una columna calculada de `liquidaciones`.
 */
const FACTURA_YA_EMITIDA = { tipo: "33", folio: "8814023", emisor: "76.999.999-K", fecha: "2026-03-09" };

/**
 * Siembra el tenant A «e-auto DaaS» ENTERO [AC-FMIG-25].
 *
 * Idempotente en el sentido de `provisionar()`: `recrear:true` la vuelve a crear desde cero.
 */
export async function sembrarTenantA(slug = "eauto_daas", { recrear = false } = {}) {
  const tenant = await pasoUnoEmpresaYVertical(slug, { vertical: "panaderia", modo: "daas", recrear });
  const actorAdmin = await sembrarActorAdmin(tenant.bd, RUT_ACTOR_ADMIN, CENTINELA_A);
  const sesionAdmin = sesionDe(actorAdmin, "admin_tenant");
  const pool = poolDelTenant(tenant);

  try {
    // El catálogo de motivos del vertical, materializado desde `vertical_template` con la única
    // función que lo copia (`sembrar_motivos`, §4.4): la base nace SOLO con los motivos de
    // disputa de la 0066, y sin los de terreno la no-entrega del §10 no tiene con qué
    // clasificarse. Activar un vertical es un INSERT de filas, jamás una migración (§2 métrica 4).
    const motivosSembrados = await sembrarMotivos(pool, tenant.vertical ?? "panaderia");

    // ── 3 EV48 ────────────────────────────────────────────────────────────────────────
    const vehiculos = [];
    for (const patente of PATENTES_EV48) {
      const alta = await crearVehiculo(pool, sesionAdmin, { patente, tipo: "furgón" });
      if (alta.tipo !== "ok") throw new Error(`seed tenant A: el alta de ${patente} rebotó (${alta.tipo}).`);
      const ficha = await editarVehiculo(pool, sesionAdmin, alta.vehiculo.id, { ...EV48 });
      if (ficha.tipo !== "ok") {
        throw new Error(`seed tenant A: cargar la ficha EV48 de ${patente} rebotó (${ficha.tipo}).`);
      }
      vehiculos.push(ficha.vehiculo);
    }

    // ── 6 usuarios: la dueña + los 5 roles invitables ─────────────────────────────────
    const equipo = { admin_tenant: [actorAdmin] };
    for (const miembro of EQUIPO) {
      const usuario = await sembrarChofer(tenant, pool, sesionAdmin, {
        rut: miembro.rut,
        nombre: `${miembro.nombre} ${CENTINELA_A}`,
        rol: miembro.rol,
      });
      (equipo[miembro.rol] ??= []).push(usuario);
    }

    // ── 3 empresas contratantes con su concepto y su usuario `cliente` ────────────────
    //
    // `cliente` NO es invitable (`ROLES_INVITABLES`, gobierno.ts): se crea DESDE la ficha de la
    // empresa con su `empresa_cliente_id` embebido —lo dictó Alexis el 09-ago-2026, Pregunta 3—
    // para que aprobar siga siendo 1 toque. Sin ficha construida todavía, el seed escribe la
    // misma fila que esa ficha escribirá.
    const empresas = {};
    for (const e of EMPRESAS) {
      const [fila] = await con(tenant.bd, ({ sql }) =>
        sql(
          `insert into empresas_cliente (rut, razon_social)
           values ($1, $2) returning id::text as id, rut, razon_social`,
          [e.rut, `${e.razonSocial} ${CENTINELA_A}`],
        ),
      );
      const [tarifa] = await con(tenant.bd, ({ sql }) =>
        sql(
          `insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
           values ($1, $2, $3, timestamptz '2026-01-01 00:00-04')
           returning id::text as id, concepto, precio_clp::int as precio_clp`,
          [fila.id, e.concepto, e.precioClp],
        ),
      );
      const [persona] = await con(tenant.bd, ({ sql }) =>
        sql("insert into personas (rut, nombre) values ($1, $2) returning id::text as id", [
          e.cliente.rut,
          `${e.cliente.nombre} ${CENTINELA_A}`,
        ]),
      );
      const [usuario] = await con(tenant.bd, ({ sql }) =>
        sql(
          `insert into usuarios (persona_id, rol, empresa_cliente_id)
           values ($1, 'cliente', $2) returning id::text as id`,
          [persona.id, fila.id],
        ),
      );
      empresas[e.clave] = { ...fila, tarifa, clienteUsuarioId: usuario.id, otdComprometidoPct: e.otdComprometidoPct };
    }

    // ── 25 destinos es-CL ─────────────────────────────────────────────────────────────
    const destinos = [];
    for (const d of DESTINOS) {
      const [fila] = await con(tenant.bd, ({ sql }) =>
        sql(
          "insert into destinos (nombre, comuna) values ($1, $2) returning id::text as id, nombre, comuna",
          [`${d.nombre} ${CENTINELA_A}`, d.comuna],
        ),
      );
      destinos.push(fila);
    }

    // ── 1 semana de agenda con las ventanas de recarga AC nocturna ────────────────────
    const bloques = [];
    for (const vehiculo of vehiculos) {
      for (let dia = 0; dia < 7; dia += 1) {
        const desde = masDias(LUNES_DE_LA_SEMANA, dia);
        const bloque = await agendarBloque(pool, sesionAdmin, tenant.slug, {
          vehiculoId: vehiculo.id,
          tipo: "recarga",
          empiezaEn: enChile(desde, RECARGA_NOCTURNA.entraHora),
          terminaEn: enChile(masDias(desde, 1), RECARGA_NOCTURNA.saleHora),
          nota: `Recarga AC nocturna ${CENTINELA_A}`,
        });
        if (bloque.tipo !== "ok") {
          throw new Error(
            `seed tenant A: la recarga nocturna del ${desde} de ${vehiculo.patente} rebotó (${bloque.tipo}).`,
          );
        }
        bloques.push(bloque.bloque);
      }
    }

    // ── La ruta del día, consolidada de las 3 empresas ────────────────────────────────
    const encargos = [];
    for (const plan of ENCARGOS_DEL_DIA) {
      const destino = destinos[plan.destino];
      const encargo = await crearEncargo(pool, sesionAdmin, {
        empresaClienteId: empresas[plan.empresa].id,
        destinoId: destino.id,
        bultos: plan.bultos,
        fechaServicio: null,
        attrs: {},
        clientUuid: randomUUID(),
      });
      if (encargo.tipo !== "ok") {
        throw new Error(`seed tenant A: el encargo de «${destino.nombre}» rebotó (${encargo.tipo}).`);
      }
      encargos.push({ ...encargo.encargo, destino, plan });
    }

    const ruta = await crearRuta(pool, sesionAdmin, {
      nombre: `Ruta consolidada del día ${CENTINELA_A}`,
      vehiculoId: vehiculos[0].id,
      fechaServicio: null,
      clientUuid: randomUUID(),
    });
    const asignacion = await asignarEncargos(pool, sesionAdmin, ruta.id, encargos.map((e) => e.id));
    if (asignacion.tipo !== "ok" || asignacion.paradas < ENCARGOS_DEL_DIA.length) {
      throw new Error(
        `seed tenant A: la asignación dejó ${asignacion.paradas ?? 0} paradas de ${ENCARGOS_DEL_DIA.length}.`,
      );
    }
    const publicacion = await publicarRuta(pool, sesionAdmin, tenant.slug, ruta.id);
    if (publicacion.tipo !== "ok") {
      throw new Error(`seed tenant A: publicar la ruta del día rebotó (${publicacion.tipo}).`);
    }

    // ── El turno del chofer de la mañana, con su captura de carga ─────────────────────
    const choferDeLaManana = equipo.chofer[0];
    const sesionChofer = sesionDe(choferDeLaManana, "chofer");
    const apertura = await abrirTurno(pool, sesionChofer, tenant.slug, vehiculos[0].id);
    if (apertura.tipo !== "ok") {
      throw new Error(`seed tenant A: abrir el turno del día rebotó (${apertura.tipo}).`);
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
      throw new Error(`seed tenant A: la captura de carga del turno rebotó (${lectura.tipo}).`);
    }

    // ── F4: entregas felices + 1 no-entrega + 1 parcial ──────────────────────────────
    const [motivoDeNoEntrega] = await con(tenant.bd, ({ sql }) =>
      sql("select id::text as id, codigo from motivos where codigo = 'cliente_ausente'"),
    );
    if (!motivoDeNoEntrega) {
      throw new Error(
        "seed tenant A: el vertical no dejó el motivo `cliente_ausente` — sin motivo de catálogo " +
          "la no-entrega del §10 no se puede clasificar.",
      );
    }
    const paradas = await con(tenant.bd, ({ sql }) =>
      sql(
        // El encargo de una parada se lee por `items`, que es el único puente entre los dos —
        // `paradas` no lleva `encargo_id`: una parada puede consolidar carga de varios encargos
        // (§3.E1.6). Es el MISMO camino que usa `aterrizarCapturas` para saber a qué encargo le
        // escribe el POD.
        `select p.id::text as id, p.orden, i.encargo_id::text as encargo_id
           from paradas p join items i on i.parada_id = p.id
          where p.ruta_id = $1 and p.tipo = 'entrega'
          group by p.id, p.orden, i.encargo_id order by p.orden`,
        [ruta.id],
      ),
    );
    const resultadoDe = new Map(encargos.map((e) => [e.id, e.plan.resultado]));
    const capturas = paradas.map((p) => {
      const resultado = resultadoDe.get(p.encargo_id) ?? "exito";
      return {
        clientUuid: randomUUID(),
        paradaId: p.id,
        tsDispositivo: new Date(),
        tzOffsetMin: -240,
        resultado,
        metodoEntrega: null,
        motivoId: resultado === "exito" ? null : motivoDeNoEntrega.id,
        items: null,
        evidencias: [],
        turnoId: null,
        secuenciaDispositivo: null,
        supersedeDe: null,
        motivo: null,
      };
    });
    const acuses = await aterrizarCapturas(pool, sesionChofer, tenant.slug, capturas, null);
    const rechazadas = acuses.filter((a) => !a?.aceptada).length;
    if (rechazadas > 0) {
      throw new Error(`seed tenant A: ${rechazadas} de ${capturas.length} PODs no fueron aceptados.`);
    }

    // ── El cierre del día: 1 devolución + 1 descuadre clasificado ─────────────────────
    //
    // El minimarket declara 3 bultos devueltos (con motivo ⇒ se materializa la fila de
    // `devoluciones`, AC-FRUT-21) y 2 faltantes. Como la ruta del seed no pasó por el andén, su
    // `cargado` es 0: la ecuación queda en −5 y el cierre entra DESCUADRADO con su bandera
    // (AC-FRUT-11) en vez de rebotar — que es la regla de oro (§4.2): la captura no se pierde
    // porque los números no cuadren, se marca.
    const cierre = await cerrarRuta(pool, sesionChofer, {
      rutaId: ruta.id,
      turnoId: apertura.turno.id,
      declaraciones: [
        {
          empresa_cliente_id: empresas.minimarket.id,
          devuelto: 3,
          faltante: 2,
          motivo_id: motivoDeNoEntrega.id,
        },
      ],
      clientUuid: randomUUID(),
      tsDispositivo: new Date().toISOString(),
      tzOffsetMin: -240,
    });
    if (cierre.tipo !== "ok") {
      throw new Error(`seed tenant A: el cierre de la ruta del día rebotó (${cierre.tipo}).`);
    }
    if (!cierre.flags.includes("cierre_descuadrado")) {
      throw new Error(
        "seed tenant A: el cierre quedó CUADRADO — el §10 pide un descuadre clasificado y este " +
          `seed no lo produjo (flags: ${JSON.stringify(cierre.flags)}).`,
      );
    }

    // ── Las liquidaciones semanales en sus 3 estados ──────────────────────────────────
    const periodo = semanaDe(new Date());
    const liquidaciones = await sembrarLiquidaciones(tenant, empresas, periodo);

    return {
      ...tenant,
      actorAdmin,
      motivosSembrados,
      equipo,
      vehiculos,
      empresas,
      destinos,
      bloques,
      encargos,
      ruta,
      turno: apertura.turno,
      soc: SOC_DE_APERTURA,
      paradas,
      cierre,
      liquidaciones,
      periodo,
      centinela: CENTINELA_A,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Las tres liquidaciones semanales del §10, cada una en un estado distinto de la máquina
 * `abierta→cerrada→pagada` (AC-FTAR-05):
 *
 *  · farmacia    — CERRADA, con el folio de la factura ya emitida REGISTRADO como
 *                  `reference_document` (jamás generado, art. 97 N°4 CT);
 *  · distribuidora — CERRADA con una línea DISPUTADA por su usuario `cliente` (AC-FTAR-06). Es
 *                  la única de las tres con líneas de verdad: `devengar_entrega()` solo devenga
 *                  el concepto `por_entrega` (§3 de la spec 06), y de las tres empresas del §10
 *                  la única con esa tarifa es la distribuidora — la farmacia cobra por bloque y
 *                  el minimarket por bulto, cuyos devengos son AC-FTAR-03 y todavía no existen.
 *                  Sembrar líneas a mano para las otras dos sería imposible además de indeseable:
 *                  el INSERT directo en `liquidacion_lineas` rebota con 42501 (§7.5);
 *  · minimarket  — PAGADA, recorriendo la máquina entera (`abierta→cerrada→pagada`), que es lo
 *                  único que la guarda de estados admite.
 */
async function sembrarLiquidaciones(tenant, empresas, periodo) {
  const una = async (texto, params = []) => (await con(tenant.bd, ({ sql }) => sql(texto, params)))[0];

  const abrir = (empresaId) =>
    una(
      `insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
       values ($1, $2::date, $3::date) returning id::text as id, estado`,
      [empresaId, periodo.inicio, periodo.fin],
    );

  // (1) Farmacia: cerrada, con el folio de tercero registrado.
  const cerrada = await abrir(empresas.farmacia.id);
  await una("update liquidaciones set estado = 'cerrada' where id = $1", [cerrada.id]);
  const folio = await una(
    `insert into reference_document (tipo, folio, emisor, fecha)
     values ($1::dte_tipo, $2, $3, $4::date)
       on conflict (tipo, folio, emisor) do nothing
     returning id::text as id, folio`,
    [FACTURA_YA_EMITIDA.tipo, FACTURA_YA_EMITIDA.folio, FACTURA_YA_EMITIDA.emisor, FACTURA_YA_EMITIDA.fecha],
  );

  // (2) Distribuidora: cerrada con una línea devengada de un POD real y DISPUTADA.
  const disputada = await abrir(empresas.distribuidora.id);
  const pods = await con(tenant.bd, ({ sql }) =>
    sql(
      `select p.id::text as id
         from entregas_pod p
         join encargos e on e.id = p.encargo_id
        where e.empresa_cliente_id = $1 and p.resultado = 'exito' and p.cerrada
        order by p.event_time`,
      [empresas.distribuidora.id],
    ),
  );
  const lineas = [];
  for (const pod of pods) {
    const { id } = await una("select devengar_entrega($1, $2)::text as id", [pod.id, disputada.id]);
    if (id) lineas.push(id);
  }
  if (lineas.length === 0) {
    throw new Error(
      "seed tenant A: la liquidación de la distribuidora quedó SIN líneas — sin línea no hay " +
        "disputa por línea que sembrar (§10).",
    );
  }
  await una("update liquidaciones set estado = 'cerrada' where id = $1", [disputada.id]);
  const motivoDeDisputa = await una("select id::text as id from motivos where codigo = 'monto_incorrecto'");
  if (!motivoDeDisputa) {
    throw new Error("seed tenant A: falta el motivo `monto_incorrecto` para disputar la línea.");
  }
  const disputa = await una("select id::text as linea_id, repetida from disputar_linea($1, $2, $3, $4, $5)", [
    lineas[0],
    motivoDeDisputa.id,
    `El monto de esta entrega no coincide con lo pactado ${CENTINELA_A}`,
    empresas.distribuidora.clienteUsuarioId,
    randomUUID(),
  ]);
  if (!disputa?.linea_id) {
    throw new Error("seed tenant A: `disputar_linea` no dejó la línea disputada.");
  }

  // (3) Minimarket: la máquina entera hasta pagada.
  const pagada = await abrir(empresas.minimarket.id);
  await una("update liquidaciones set estado = 'cerrada' where id = $1", [pagada.id]);
  await una("update liquidaciones set estado = 'pagada' where id = $1", [pagada.id]);

  return {
    cerrada: { id: cerrada.id, empresa: "farmacia", estado: "cerrada", folio: folio?.folio ?? FACTURA_YA_EMITIDA.folio },
    disputada: { id: disputada.id, empresa: "distribuidora", estado: "cerrada", lineas, lineaDisputada: disputa.linea_id },
    pagada: { id: pagada.id, empresa: "minimarket", estado: "pagada" },
  };
}

// --- CLI ---------------------------------------------------------------------------------
async function principal(argv) {
  const [orden, ...resto] = argv;
  const recrear = resto.includes("--recrear");
  const libres = resto.filter((a) => !a.startsWith("--"));
  if (orden !== "sembrar") {
    console.error("tenant-a.mjs: uso: sembrar [slug=eauto_daas] [--recrear]");
    return 2;
  }
  const r = await sembrarTenantA(libres[0] ?? "eauto_daas", { recrear });
  console.log(
    `tenant-a: ${r.bd} lista · ${r.vehiculos.length} EV48 · ${Object.values(r.equipo).flat().length} usuarios · ` +
      `${Object.keys(r.empresas).length} contratantes · ${r.destinos.length} destinos · ` +
      `${r.bloques.length} bloques de recarga · ${r.paradas.length} paradas · centinela ${r.centinela}`,
  );
  return 0;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`tenant-a: ${e.message}`);
      process.exit(1);
    });
}
