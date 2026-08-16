// La OPERACIÓN del tenant B «Rutapan» [AC-FMIG-26] — specs/flota/08-diseno-miga-onboarding.md
// §7, §10 del maestro (docs/PROMPT_MAESTRO_KILORUTA.md §10): «2 rutas maestras de madrugada
// consolidadas de 12 y 9 paradas, manifiestos firmados con sus DTEs ya emitidos, 1 encargo
// creado en andén, 1 reintento, cierre con ecuación cuadrada».
//
// Mitad partida de AC-FMIG-18, que cerró sobre la identidad de B (vertical, tema, terminología
// extrema, 2 EV48 y 4 panaderías) y dejó declarado que la operación quedaba fuera.
//
// ─── CADA PIEZA ENTRA POR EL SERVICIO DE SU AC DUEÑO ──────────────────────────────
//
// `crearRuta`/`instanciarDesdeMaestra`/`asignarEncargos`/`publicarRuta` (AC-FRUT-04/05/06),
// `crearEncargo`/`reintentarEncargo` (AC-FRUT-03), `abrirTurno` (AC-FVEH-17),
// `confirmarManifiesto`/`asociarDocumento`/`traspasarCustodia` (AC-FRUT-07/08/09),
// `aterrizarCapturas` (AC-FPOD-01) y `cerrarRuta` (AC-FRUT-11/21). Un seed que escribiera esas
// filas a mano dejaría de probar el producto y pasaría a probarse a sí mismo.
//
// ─── LAS CUATRO PIEZAS QUE HOY NO TIENEN SERVICIO, Y POR QUÉ SE ESCRIBEN A MANO ───
//
//   1. `rutas.es_maestra` y las paradas de la PLANTILLA. `crearRuta` crea rutas del día;
//      `instanciarDesdeMaestra` (AC-FRUT-06) consume una maestra pero ninguna función la crea, y
//      `asignarEncargos` solo fabrica paradas de tipo `entrega`. La maestra es justamente lo que
//      dice por dónde se pasa —incluida la parada de CARGA del andén—, así que sus paradas se
//      insertan acá y el día nace de ellas por el servicio de verdad.
//   2. Los `items` de la parada de CARGA. `ecuacion_de_cierre()` (0045) toma `cargado` de los
//      `manifiesto_items` colgados de la parada de carga, y `loDeclaradoEn()` arma el
//      sub-manifiesto leyendo los `items` de ESA parada; `asignarEncargos` solo los crea en las
//      de entrega. El espejo se escribe acá, con la misma forma que el fixture de
//      `apps/flota/e2e/cierre-ruta.spec.ts`.
//   3. `items.qty_entregada`. La 0045 dice con todas las letras «la escribe el módulo 04 al
//      capturar el POD; acá solo se lee», y hoy NINGÚN camino de la app la escribe —
//      `aterrizarCapturas` persiste el POD y nada más—. Sin ella `entregado` es 0 y ninguna ruta
//      podría cerrar cuadrada, que es lo que este AC exige mostrar.
//   4. `paradas.resultado`. El trigger `paradas_cierran_sus_encargos` (0048) es el ÚNICO camino a
//      `encargo.estado = 'no_entregado'`, y `reintentarEncargo` exige ese estado; `aterrizarCapturas`
//      tampoco cierra la parada todavía. Se escribe el hecho, no el estado: el estado lo deriva el
//      trigger, que es la autoridad.
//
// Ninguna de las cuatro inventa esquema (todas son columnas ya migradas) y ninguna reimplementa
// una regla de negocio: la ecuación, la máquina de estados y el gate del DTE siguen siendo de la
// BD y de los servicios.
//
// ─── «ENCARGO CREADO EN ANDÉN» ────────────────────────────────────────────────────
//
// El maestro (§10, F C2) lo nombra con un evento propio, `encargo.creado_en_anden`, que NO existe
// todavía en `EVENTOS_OPERACION` (gobierno.ts) — quien lo agregue es el AC del flujo del
// responsable de carga, no este seed, y el motor jamás inventa catálogo. Lo que SÍ es cierto y
// observable hoy es quién lo creó: el encargo de andén de este seed nace de la sesión del
// `responsable_carga`, sobre una ruta todavía sin publicar, y consolida en una parada que ya
// existía — que es exactamente la carga que aparece en el andén a las cuatro de la mañana.
import { randomUUID } from "node:crypto";
import { con } from "../conectar.mjs";
import { sesionDe, sembrarChofer } from "./comun.mjs";
import { crearEncargo, reintentarEncargo } from "../../../apps/flota/src/servidor/encargos.ts";
import {
  crearRuta,
  instanciarDesdeMaestra,
  asignarEncargos,
  publicarRuta,
} from "../../../apps/flota/src/servidor/rutas.ts";
import { abrirTurno } from "../../../apps/flota/src/servidor/turnos.ts";
import {
  confirmarManifiesto,
  asociarDocumento,
  traspasarCustodia,
  estadoDelGate,
} from "../../../apps/flota/src/servidor/manifiestos.ts";
import { aterrizarCapturas } from "../../../apps/flota/src/servidor/capturas.ts";
import { cerrarRuta } from "../../../apps/flota/src/servidor/cierres.ts";
import { sembrarMotivos } from "../../../apps/flota/src/servidor/motivos.ts";
import { fijarPin } from "../../../apps/flota/src/servidor/pin.ts";

/** RUTs de la lista congelada (`db/flota/ruts-sinteticos.mjs`, AC-FIDN-21). B vive en su PROPIA
 *  base física: repetir un RUT que otro tenant usa no choca con ningún UNIQUE `(tenant_id, …)`. */
const EQUIPO_DE_OPERACION = [
  { clave: "anden", rol: "responsable_carga", rut: "4.444.444-5", nombre: "Responsable del andén de Rutapan" },
  { clave: "choferNorte", rol: "chofer", rut: "12.345.678-5", nombre: "Panadero del recorrido norte" },
  { clave: "choferSur", rol: "chofer", rut: "7.654.321-6", nombre: "Panadero del recorrido sur" },
];

/** PINs de terreno del seed. No abren nada fuera de la base local del seed y son los que
 *  `traspasarCustodia` verifica de verdad con argon2id: sin un PIN REAL la doble firma del §4.5
 *  no se puede sembrar, y un traspaso sin firmas no es el hecho que sostiene la disputa. */
const PIN_ANDEN = "704183";
const PIN_CHOFER = "319027";

/** La madrugada del §10: el camión sale del andén a las 03:00 y la última parada cierra a las
 *  07:00, hora de Chile continental en horario de verano (UTC-3 en marzo). La ventana se escribe
 *  en la MAESTRA y el día la hereda al instanciarse — que es lo que hace que estas dos rutas sean
 *  «de madrugada» y no dos rutas cualesquiera. */
const MADRUGADA = { desde: "03:00", hasta: "07:00", offset: "-03:00" };
const DIA_DE_LA_OPERACION = "2026-03-03";

/** El andén de Rutapan: origen de las dos rutas y destino de sus paradas de carga. */
const ANDEN = { nombre: "Andén central de Rutapan", comuna: "Quilicura" };

/**
 * Las 2 rutas maestras del §10. `paradas` cuenta la fila de `paradas` de la plantilla: 1 de CARGA
 * en el andén + N de entrega, 12 y 9 en total. El andén es una parada de la ruta y no un preámbulo
 * —el §5.2 F2 la trata como tal— así que contarla es contar lo que el chofer ve en su lista.
 *
 * Los nombres llevan los términos RENOMBRADOS de B («Recorrido-B7», «Reparto-B7f2»), no los
 * canónicos: el §9.2 usa a B como el segundo lado de la suite e2e doble, y una ruta sembrada con
 * «Ruta» adentro haría pasar un e2e que buscara el término del tenant sin que la pantalla lo
 * hubiera resuelto.
 */
const RUTAS_MAESTRAS = [
  {
    clave: "norte",
    nombre: "Recorrido-B7 madrugada norte",
    paradas: 12,
    destinos: [
      { nombre: "Sucursal Independencia 1440", comuna: "Independencia" },
      { nombre: "Sucursal Recoleta 2210", comuna: "Recoleta" },
      { nombre: "Sucursal Conchalí 780", comuna: "Conchalí" },
      { nombre: "Sucursal Renca 3120", comuna: "Renca" },
      { nombre: "Sucursal Quilicura 560", comuna: "Quilicura" },
      { nombre: "Sucursal Huechuraba 990", comuna: "Huechuraba" },
      { nombre: "Sucursal Cerro Navia 410", comuna: "Cerro Navia" },
      { nombre: "Sucursal Pudahuel 1870", comuna: "Pudahuel" },
      { nombre: "Sucursal Lo Prado 620", comuna: "Lo Prado" },
      { nombre: "Sucursal Quinta Normal 1330", comuna: "Quinta Normal" },
      { nombre: "Sucursal Estación Central 2450", comuna: "Estación Central" },
    ],
  },
  {
    clave: "sur",
    nombre: "Recorrido-B7 madrugada sur",
    paradas: 9,
    destinos: [
      { nombre: "Sucursal San Miguel 1180", comuna: "San Miguel" },
      { nombre: "Sucursal San Joaquín 740", comuna: "San Joaquín" },
      { nombre: "Sucursal La Cisterna 2060", comuna: "La Cisterna" },
      { nombre: "Sucursal El Bosque 330", comuna: "El Bosque" },
      { nombre: "Sucursal La Granja 1520", comuna: "La Granja" },
      { nombre: "Sucursal La Florida 4100", comuna: "La Florida" },
      { nombre: "Sucursal Puente Alto 2890", comuna: "Puente Alto" },
      { nombre: "Sucursal Macul 1650", comuna: "Macul" },
    ],
  },
];

/** Los bultos de cada parada, en orden. Distintos entre sí a propósito: una ecuación de cierre
 *  con todos los renglones iguales cuadra por accidente aunque el código sume mal. */
const BULTOS = [8, 6, 12, 5, 9, 7, 11, 4, 10, 6, 13, 5, 9, 8, 7, 12, 6, 10, 4];

/** El encargo que aparece en el ANDÉN a las cuatro de la mañana: no estaba planificado y va a un
 *  destino que la ruta ya visita, así que consolida en la parada que ya existe (§3.E1.5) y el
 *  recorrido sigue teniendo sus 12 paradas. */
const ENCARGO_DE_ANDEN = { bultos: 7, indiceDeDestino: 2 };

/** El emisor de las guías de despacho: la propia Rutapan, que es quien despacha la mercadería de
 *  sus panaderías cliente. RUT sintáctico de la lista congelada (§7.8). */
const EMISOR_DE_LAS_GUIAS = "78.333.333-3";

/** Guía de despacho electrónica (tipo 52 del SII). El folio es de un documento YA EMITIDO por el
 *  sistema tributario del tercero: la app lo REGISTRA y jamás lo genera (art. 97 N°4 CT), y sin
 *  él no hay salida a ruta (art. 55 DL 825). */
const DTE = { tipo: "52", desdeElFolio: 4410200 };

const enChile = (dia, hora) => `${dia}T${hora}:00${MADRUGADA.offset}`;

/**
 * Siembra la operación de B sobre su identidad ya sembrada [AC-FMIG-26].
 *
 * `tenant` y `pool` son los que `sembrarTenantB` ya abrió; `identidad` trae sus vehículos y sus
 * 4 panaderías cliente. Devuelve todo lo observable para que el test cuente contra la BASE.
 */
export async function sembrarOperacionB(tenant, pool, sesionAdmin, identidad) {
  // El catálogo de motivos del vertical, materializado con la única función que lo copia
  // (`sembrar_motivos`, §4.4): sin él la devolución del cierre no tiene con qué clasificarse.
  const motivosSembrados = await sembrarMotivos(pool, tenant.vertical ?? "panaderia");
  const [motivoDeVuelta] = await con(tenant.bd, ({ sql }) =>
    sql("select id::text as id, codigo from motivos where codigo = 'cliente_ausente'"),
  );
  if (!motivoDeVuelta) {
    throw new Error(
      "seed operación B: el vertical no dejó el motivo `cliente_ausente` — sin motivo de catálogo " +
        "la vuelta de la mercadería al andén no se puede clasificar (§5.2 F5).",
    );
  }

  // ── El equipo de terreno: el andén y los dos panaderos que manejan ────────────────
  const equipo = {};
  for (const miembro of EQUIPO_DE_OPERACION) {
    const usuario = await sembrarChofer(tenant, pool, sesionAdmin, {
      rut: miembro.rut,
      nombre: `${miembro.nombre} ${identidad.centinela}`,
      rol: miembro.rol,
    });
    // El PIN de terreno se fija por el servicio que lo hashea (argon2id, jamás en claro en la
    // base): es el mismo que `traspasarCustodia` verifica al firmar.
    await fijarPin(pool, usuario.usuarioId, miembro.clave === "anden" ? PIN_ANDEN : PIN_CHOFER);
    equipo[miembro.clave] = usuario;
  }
  const sesionAnden = sesionDe(equipo.anden, "responsable_carga");

  const [anden] = await con(tenant.bd, ({ sql }) =>
    sql("insert into destinos (nombre, comuna) values ($1, $2) returning id::text as id, nombre", [
      `${ANDEN.nombre} ${identidad.centinela}`,
      ANDEN.comuna,
    ]),
  );

  let siguienteBulto = 0;
  let siguienteFolio = DTE.desdeElFolio;
  const rutas = {};

  for (const [i, plan] of RUTAS_MAESTRAS.entries()) {
    const chofer = i === 0 ? equipo.choferNorte : equipo.choferSur;
    const sesionChofer = sesionDe(chofer, "chofer");
    const vehiculo = identidad.vehiculos[i];

    // ── Los destinos del recorrido ──────────────────────────────────────────────────
    const destinos = [];
    for (const d of plan.destinos) {
      const [fila] = await con(tenant.bd, ({ sql }) =>
        sql(
          "insert into destinos (nombre, comuna) values ($1, $2) returning id::text as id, nombre",
          [`${d.nombre} ${identidad.centinela}`, d.comuna],
        ),
      );
      destinos.push(fila);
    }

    // ── La ruta MAESTRA con sus paradas de plantilla ────────────────────────────────
    const maestra = await crearRuta(pool, sesionAdmin, {
      nombre: plan.nombre,
      vehiculoId: null,
      fechaServicio: DIA_DE_LA_OPERACION,
      clientUuid: randomUUID(),
    });
    const ventana = `[${enChile(DIA_DE_LA_OPERACION, MADRUGADA.desde)},${enChile(DIA_DE_LA_OPERACION, MADRUGADA.hasta)})`;
    await con(tenant.bd, async ({ sql }) => {
      await sql("update rutas set es_maestra = true where id = $1", [maestra.id]);
      await sql(
        `insert into paradas (ruta_id, tipo, orden, destino_id, ventana)
         values ($1, 'carga', 1, $2, $3::tstzrange)`,
        [maestra.id, anden.id, ventana],
      );
      for (const [k, destino] of destinos.entries()) {
        await sql(
          `insert into paradas (ruta_id, tipo, orden, destino_id, ventana)
           values ($1, 'entrega', $2, $3, $4::tstzrange)`,
          [maestra.id, k + 2, destino.id, ventana],
        );
      }
    });

    // ── El día nace de la plantilla por el servicio de verdad (AC-FRUT-06) ──────────
    const instancia = await instanciarDesdeMaestra(pool, sesionAdmin, maestra.id, {
      vehiculoId: vehiculo.id,
      fechaServicio: DIA_DE_LA_OPERACION,
    });
    if (instancia.tipo !== "ok") {
      throw new Error(`seed operación B: instanciar «${plan.nombre}» rebotó (${instancia.tipo}).`);
    }
    if (instancia.paradas !== plan.paradas) {
      throw new Error(
        `seed operación B: «${plan.nombre}» quedó con ${instancia.paradas} paradas y el §10 pide ${plan.paradas}.`,
      );
    }
    const dia = instancia.ruta;

    // ── Los encargos del día, consolidados de las 4 panaderías ──────────────────────
    const encargos = [];
    for (const [k, destino] of destinos.entries()) {
      const empresa = identidad.empresas[k % identidad.empresas.length];
      const bultos = BULTOS[siguienteBulto++ % BULTOS.length];
      const alta = await crearEncargo(pool, sesionAdmin, {
        empresaClienteId: empresa.id,
        destinoId: destino.id,
        bultos,
        fechaServicio: DIA_DE_LA_OPERACION,
        attrs: {},
        clientUuid: randomUUID(),
      });
      if (alta.tipo !== "ok") {
        throw new Error(`seed operación B: el encargo de «${destino.nombre}» rebotó (${alta.tipo}).`);
      }
      encargos.push({ ...alta.encargo, empresa, destino, bultos, enAnden: false });
    }

    // El encargo que apareció en el ANDÉN, creado por el responsable de carga sobre la ruta
    // todavía sin publicar. Va al mismo destino que una parada que ya existe: consolida (§3.E1.5).
    if (plan.clave === "norte") {
      const destino = destinos[ENCARGO_DE_ANDEN.indiceDeDestino];
      const empresa = identidad.empresas[identidad.empresas.length - 1];
      const alta = await crearEncargo(pool, sesionAnden, {
        empresaClienteId: empresa.id,
        destinoId: destino.id,
        bultos: ENCARGO_DE_ANDEN.bultos,
        fechaServicio: DIA_DE_LA_OPERACION,
        // `attrs` va VACÍO: las claves libres las valida `crearEncargo` contra el catálogo del
        // vertical, y «de dónde salió» no es un atributo de carga — es quién lo creó.
        attrs: {},
        clientUuid: randomUUID(),
      });
      if (alta.tipo !== "ok") {
        throw new Error(`seed operación B: el encargo de andén rebotó (${alta.tipo}).`);
      }
      encargos.push({
        ...alta.encargo,
        empresa,
        destino,
        bultos: ENCARGO_DE_ANDEN.bultos,
        enAnden: true,
      });
    }

    const asignacion = await asignarEncargos(pool, sesionAdmin, dia.id, encargos.map((e) => e.id));
    if (asignacion.tipo !== "ok") {
      throw new Error(`seed operación B: asignar a «${plan.nombre}» rebotó (${asignacion.tipo}).`);
    }
    // Cero paradas NUEVAS: cada encargo cayó en una parada que la maestra ya traía —incluido el
    // de andén, que consolidó—. Si esto creciera, el recorrido dejaría de tener las paradas del §10.
    if (asignacion.paradas !== 0) {
      throw new Error(
        `seed operación B: «${plan.nombre}» creó ${asignacion.paradas} parada(s) fuera de la maestra.`,
      );
    }
    const publicacion = await publicarRuta(pool, sesionAdmin, tenant.slug, dia.id);
    if (publicacion.tipo !== "ok") {
      throw new Error(`seed operación B: publicar «${plan.nombre}» rebotó (${publicacion.tipo}).`);
    }

    // ── El turno del panadero y el andén ────────────────────────────────────────────
    const apertura = await abrirTurno(pool, sesionChofer, tenant.slug, vehiculo.id);
    if (apertura.tipo !== "ok") {
      throw new Error(`seed operación B: abrir el turno de «${plan.nombre}» rebotó (${apertura.tipo}).`);
    }

    const [carga] = await con(tenant.bd, ({ sql }) =>
      sql("select id::text as id from paradas where ruta_id = $1 and tipo = 'carga'", [dia.id]),
    );
    // El espejo declarado en el andén (pieza 2 de la cabecera): una línea por encargo, con los
    // bultos que la planificación dice. Es contra ESTO que el andén cuenta.
    const itemsDeCarga = [];
    for (const encargo of encargos) {
      const [item] = await con(tenant.bd, ({ sql }) =>
        sql(
          `insert into items (parada_id, encargo_id, qty_planificada)
           values ($1, $2, $3) returning id::text as id, empresa_cliente_id::text as empresa_cliente_id`,
          [carga.id, encargo.id, encargo.bultos],
        ),
      );
      itemsDeCarga.push({ ...item, encargo });
    }

    // ── Un sub-manifiesto POR EMPRESA, cada uno con su DTE ya emitido ───────────────
    const manifiestos = [];
    for (const empresa of identidad.empresas) {
      const mios = itemsDeCarga.filter((it) => it.empresa_cliente_id === empresa.id);
      if (mios.length === 0) continue;

      const confirmacion = await confirmarManifiesto(pool, sesionAnden, tenant.slug, {
        paradaId: carga.id,
        empresaClienteId: empresa.id,
        // El andén cuenta lo que hay y coincide con lo declarado: el descuadre de custodia es el
        // caso de AC-FRUT-10 y no el que este seed necesita mostrar.
        conteos: mios.map((it) => ({ item_id: it.id, qty_confirmada: it.encargo.bultos })),
        clientUuid: randomUUID(),
        tsDispositivo: enChile(DIA_DE_LA_OPERACION, MADRUGADA.desde),
        tzOffsetMin: -180,
        incompletoConfirmado: false,
        turnoId: apertura.turno.id,
        fotoSha256: null,
      });
      if (confirmacion.items !== mios.length) {
        throw new Error(
          `seed operación B: el manifiesto de ${empresa.razon_social} contó ${confirmacion.items} ` +
            `de ${mios.length} ítem(s).`,
        );
      }

      // El DTE ya emitido, tecleado en el andén: una guía por empresa y ruta, asociada a CADA
      // ítem a bordo. Sin esto el traspaso saldría con `item_sin_dte` (art. 55 DL 825).
      const folio = String(siguienteFolio++);
      const enGate = await estadoDelGate(pool, sesionAnden, confirmacion.manifiesto_id);
      for (const item of enGate) {
        const asociacion = await asociarDocumento(pool, sesionAnden, {
          manifiestoItemId: item.id,
          tipo: DTE.tipo,
          folio,
          emisor: EMISOR_DE_LAS_GUIAS,
          fecha: DIA_DE_LA_OPERACION,
        });
        if (asociacion.tipo !== "ok") {
          throw new Error(
            `seed operación B: asociar la guía ${folio} al ítem ${item.id} rebotó (${asociacion.tipo}).`,
          );
        }
      }

      // ── La doble firma: el andén libera, el panadero recibe (§4.5) ────────────────
      const traspaso = await traspasarCustodia(pool, sesionAnden, tenant.slug, {
        turnoId: apertura.turno.id,
        manifiestoId: confirmacion.manifiesto_id,
        liberoUsuarioId: equipo.anden.usuarioId,
        liberoPin: PIN_ANDEN,
        recibeUsuarioId: chofer.usuarioId,
        recibePin: PIN_CHOFER,
        sello: `SELLO-${folio}`,
        clientUuid: randomUUID(),
        tsDispositivo: enChile(DIA_DE_LA_OPERACION, MADRUGADA.desde),
        tzOffsetMin: -180,
      });
      if (traspaso.tipo !== "ok") {
        throw new Error(
          `seed operación B: el traspaso de ${empresa.razon_social} rebotó (${traspaso.tipo}).`,
        );
      }
      // El camión sale LEGAL: con el DTE de cada bulto asociado, `item_sin_dte` no puede estar.
      if (traspaso.flags.includes("item_sin_dte")) {
        throw new Error(
          `seed operación B: el manifiesto de ${empresa.razon_social} salió SIN DTE (art. 55 DL 825).`,
        );
      }
      manifiestos.push({
        id: confirmacion.manifiesto_id,
        empresa_cliente_id: empresa.id,
        folio,
        items: enGate.length,
        firmas: traspaso.firmas,
        custody_transfer_id: traspaso.custody_transfer_id,
      });
    }

    // ── F4: el recorrido, con una no-entrega en el del sur ──────────────────────────
    //
    // El recorrido norte entrega todo; el del sur deja UNA parada sin entregar, que es la que
    // produce el reintento y la devolución del cierre. Un día en que todo sale bien no ejercita
    // ni una ni otra.
    const paradasDeEntrega = await con(tenant.bd, ({ sql }) =>
      sql(
        `select p.id::text as id, p.orden, i.id::text as item_id, i.encargo_id::text as encargo_id,
                i.qty_planificada
           from paradas p join items i on i.parada_id = p.id
          where p.ruta_id = $1 and p.tipo = 'entrega'
          order by p.orden, i.id`,
        [dia.id],
      ),
    );
    const ordenFallido = plan.clave === "sur" ? paradasDeEntrega.at(-1).orden : null;
    const idsDeParada = [...new Set(paradasDeEntrega.map((p) => p.id))];
    const capturas = idsDeParada.map((paradaId) => {
      const fallida = paradasDeEntrega.some((p) => p.id === paradaId && p.orden === ordenFallido);
      return {
        clientUuid: randomUUID(),
        paradaId,
        tsDispositivo: new Date(enChile(DIA_DE_LA_OPERACION, MADRUGADA.hasta)),
        tzOffsetMin: -180,
        resultado: fallida ? "fallo" : "exito",
        metodoEntrega: null,
        motivoId: fallida ? motivoDeVuelta.id : null,
        items: null,
        evidencias: [],
        turnoId: apertura.turno.id,
        secuenciaDispositivo: null,
        supersedeDe: null,
        motivo: null,
      };
    });
    const acuses = await aterrizarCapturas(pool, sesionChofer, tenant.slug, capturas, null);
    const rechazadas = acuses.filter((a) => !a?.aceptada).length;
    if (rechazadas > 0) {
      throw new Error(`seed operación B: ${rechazadas} de ${capturas.length} PODs no fueron aceptados.`);
    }

    // Lo entregado por ítem (pieza 3 de la cabecera) y el cierre de la parada fallida (pieza 4),
    // que es lo que el trigger de la 0048 convierte en `no_entregado`.
    let encargoFallido = null;
    await con(tenant.bd, async ({ sql }) => {
      for (const fila of paradasDeEntrega) {
        const entregado = fila.orden === ordenFallido ? 0 : fila.qty_planificada;
        await sql("update items set qty_entregada = $2 where id = $1", [fila.item_id, entregado]);
        if (fila.orden === ordenFallido) encargoFallido = fila.encargo_id;
      }
      // El CHECK `paradas_resultado_solo_al_cerrar` (0037) exige que el resultado llegue JUNTO
      // con el cierre de la parada: una parada que todavía no se cerró no puede tener resultado.
      await sql(
        `update paradas set estado = 'done', resultado = 'exito'::parada_resultado
          where ruta_id = $1 and tipo = 'entrega' and orden is distinct from $2`,
        [dia.id, ordenFallido],
      );
      if (ordenFallido !== null) {
        await sql(
          `update paradas set estado = 'done', resultado = 'fallo'::parada_resultado
            where ruta_id = $1 and orden = $2`,
          [dia.id, ordenFallido],
        );
      }
    });

    // ── El reintento: encargo NUEVO que apunta al que no se entregó (AC-FRUT-03) ────
    let reintento = null;
    if (encargoFallido) {
      const hecho = await reintentarEncargo(pool, sesionAdmin, encargoFallido, "2026-03-04");
      if (hecho.tipo !== "ok") {
        throw new Error(`seed operación B: el reintento rebotó (${hecho.tipo}).`);
      }
      reintento = { ...hecho.encargo, reintento_de: encargoFallido };
    }

    // ── El cierre con la ecuación CUADRADA ──────────────────────────────────────────
    //
    // Lo que no se entregó volvió al andén y se declara `devuelto` con su motivo: `cargado =
    // entregado + devuelto + faltante` cierra en cero para cada panadería. La ecuación no se suma
    // acá — la calcula `ecuacion_de_cierre()` y este seed solo comprueba que dio cero.
    const declaraciones = [];
    if (encargoFallido) {
      const [devuelto] = await con(tenant.bd, ({ sql }) =>
        sql(
          "select empresa_cliente_id::text as empresa_cliente_id, bultos from encargos where id = $1",
          [encargoFallido],
        ),
      );
      declaraciones.push({
        empresa_cliente_id: devuelto.empresa_cliente_id,
        devuelto: devuelto.bultos,
        faltante: 0,
        motivo_id: motivoDeVuelta.id,
      });
    }
    const cierre = await cerrarRuta(pool, sesionChofer, {
      rutaId: dia.id,
      turnoId: apertura.turno.id,
      declaraciones,
      clientUuid: randomUUID(),
      tsDispositivo: enChile(DIA_DE_LA_OPERACION, MADRUGADA.hasta),
      tzOffsetMin: -180,
    });
    if (cierre.tipo !== "ok") {
      throw new Error(`seed operación B: el cierre de «${plan.nombre}» rebotó (${cierre.tipo}).`);
    }
    if (cierre.flags.length > 0) {
      const sinCuadrar = cierre.renglones
        .filter((r) => r.diferencia !== 0)
        .map((r) => `${r.empresa}: ${r.diferencia}`)
        .join("; ");
      throw new Error(
        `seed operación B: «${plan.nombre}» NO cerró cuadrada (${sinCuadrar || cierre.flags.join(",")}).`,
      );
    }

    rutas[plan.clave] = {
      maestraId: maestra.id,
      diaId: dia.id,
      paradas: instancia.paradas,
      encargos,
      manifiestos,
      turno: apertura.turno,
      chofer,
      cierre,
      reintento,
      encargoFallido,
    };
  }

  return { motivosSembrados, equipo, anden, rutas, dia: DIA_DE_LA_OPERACION };
}
