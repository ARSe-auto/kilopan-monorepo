#!/usr/bin/env node
// La OPERACIÓN del tenant B «Rutapan» contra el cluster real [AC-FMIG-26] —
// specs/flota/08-diseno-miga-onboarding.md §7, §10 del maestro.
//
// Mitad partida de AC-FMIG-18, que cerró sobre la IDENTIDAD de B (vertical, tema, terminología
// extrema, 2 EV48, 4 panaderías) y dejó declarada como pendiente la operación: 2 rutas maestras
// de madrugada de 12 y 9 paradas, manifiestos firmados con su DTE ya emitido, 1 encargo creado en
// andén, 1 reintento y el cierre con ecuación cuadrada.
//
// Todo se cuenta contra la BASE y no contra el valor de retorno del seed: un seed que se aserta a
// sí mismo por lo que devolvió no prueba que las filas quedaran escritas.
//
// ─── LOS DOS CASOS DE REBOTE DEL AC, CON MUTANTE REAL ────────────────────────────────
//
//   · «cierre que no cuadra ⇒ rojo»: se le quita UN bulto a lo entregado de una parada y la
//     ecuación de la BD —no una suma repetida acá— pasa a acusar diferencia; al reponerlo vuelve
//     a cero. Sin el mutante, un test que solo mirara la ruta cuadrada sería verde aunque
//     `ecuacion_de_cierre()` devolviera cero siempre.
//   · «manifiesto sin DTE ⇒ rojo»: se arma un sub-manifiesto NUEVO por el servicio de verdad
//     (`confirmarManifiesto`) y se lo traspasa SIN asociarle documento: `traspasarCustodia` tiene
//     que marcar `item_sin_dte` (art. 55 DL 825). El traspaso igual entra —el camión ya está en
//     la calle y rebotar solo borraría la constancia (§4.2)—, y lo que el AC exige es la marca.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { con } from "../conectar.mjs";
import { sembrarTenantB, CENTINELA_B } from "../seeds/tenant-b.mjs";
import { poolDelTenant, sesionDe } from "../seeds/comun.mjs";
import {
  confirmarManifiesto,
  traspasarCustodia,
} from "../../../apps/flota/src/servidor/manifiestos.ts";

const SLUG = "gate_seed_b_op";
let b;

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  b = await sembrarTenantB(SLUG, { recrear: true });
});

const enLaBase = (texto, params = []) => con(b.bd, ({ sql }) => sql(texto, params));
const una = async (texto, params = []) => (await enLaBase(texto, params))[0];

test("[AC-FMIG-26] 2 rutas maestras de madrugada, de 12 y 9 paradas, con el día instanciado de ellas", async () => {
  const maestras = await enLaBase(
    "select id::text as id, nombre from rutas where es_maestra order by nombre",
  );
  assert.equal(maestras.length, 2, "el §10 pide DOS rutas maestras");

  for (const maestra of maestras) {
    // El nombre lleva los términos RENOMBRADOS de B y no los canónicos (§9.2, segundo lado de la
    // suite e2e doble): una maestra sembrada con «Ruta» adentro haría pasar un e2e que buscara el
    // término del tenant sin que la pantalla lo hubiera resuelto.
    assert.ok(
      maestra.nombre.includes("Recorrido-B7"),
      `«${maestra.nombre}» no usa el término renombrado de B`,
    );
    assert.ok(!/\bRuta\b/.test(maestra.nombre), `«${maestra.nombre}» usa el término canónico`);
  }

  const conteos = await enLaBase(
    `select r.id::text as id, r.es_maestra, r.origen::text as origen,
            count(*) filter (where p.tipo = 'carga')::int as carga,
            count(*)::int as paradas
       from rutas r join paradas p on p.ruta_id = r.id
      group by r.id, r.es_maestra, r.origen
      order by count(*) desc`,
  );
  // Dos maestras y dos días nacidos de ellas: mismas paradas, 12 y 9.
  const deMaestras = conteos.filter((c) => c.es_maestra).map((c) => c.paradas).sort((x, y) => y - x);
  const deDias = conteos.filter((c) => !c.es_maestra).map((c) => c.paradas).sort((x, y) => y - x);
  assert.deepEqual(deMaestras, [12, 9]);
  assert.deepEqual(deDias, [12, 9], "el día tiene que heredar las paradas de su maestra");
  for (const c of conteos) {
    assert.equal(c.carga, 1, "cada recorrido lleva UNA parada de carga: el andén (§5.2 F2)");
    if (!c.es_maestra) assert.equal(c.origen, "maestra", "el día no nació de la plantilla");
  }

  // De madrugada de verdad: la ventana comprometida entra a las 03:00 y sale a las 07:00 de
  // Chile, no a una hora cualquiera. Se lee en la zona, no en UTC, porque es lo que ve la persona.
  const ventanas = await enLaBase(
    `select distinct
            extract(hour from lower(ventana) at time zone 'America/Santiago')::int as entra,
            extract(hour from upper(ventana) at time zone 'America/Santiago')::int as sale
       from paradas where ventana is not null`,
  );
  assert.equal(ventanas.length, 1, "las paradas no comparten una sola ventana de madrugada");
  assert.equal(ventanas[0].entra, 3);
  assert.equal(ventanas[0].sale, 7);

  // Las dos rutas del día salieron PUBLICADAS, cada una con su EV48: publicar es lo que congela
  // la promesa y pone al chofer en la calle (§4.5, §5.2 F1).
  const publicadas = await enLaBase(
    "select count(*)::int as n from rutas where not es_maestra and publicada_en is not null and vehiculo_id is not null",
  );
  assert.equal(publicadas[0].n, 2);
});

test("[AC-FMIG-26] los manifiestos salieron FIRMADOS y con su DTE ya emitido asociado a cada bulto", async () => {
  // Un sub-manifiesto POR EMPRESA (§5.2 F2), colgado de la parada de carga.
  const manifiestos = await enLaBase(
    `select m.id::text as id, m.empresa_cliente_id::text as empresa_cliente_id
       from manifiestos m join paradas p on p.id = m.parada_id
      where p.tipo = 'carga'`,
  );
  assert.ok(manifiestos.length >= 8, `${manifiestos.length} sub-manifiestos: se esperaban 4 por ruta`);

  // NI UN ítem a bordo sin documento y sin bajada: es el gate del art. 55 DL 825 leído desde la
  // base, con la MISMA condición que `traspasarCustodia` evalúa al soltar la carga.
  const sinDte = await una(
    `select count(*)::int as n
       from manifiesto_items mi
       left join manifiesto_item_documento d on d.manifiesto_item_id = mi.id
      where mi.qty_confirmada > 0 and d.reference_document_id is null and d.bajado_motivo is null`,
  );
  assert.equal(sinDte.n, 0, "hay mercadería a bordo sin DTE: el camión no podía salir");

  // El folio es de un documento de TERCERO que la app REGISTRA, jamás genera (art. 97 N°4 CT):
  // vive en `reference_document`, con su tipo del SII y su emisor, y no en una columna calculada.
  const documentos = await enLaBase(
    "select tipo::text as tipo, folio, emisor from reference_document order by folio",
  );
  assert.ok(documentos.length >= 8, `solo ${documentos.length} DTEs: se esperaba uno por empresa y ruta`);
  for (const d of documentos) {
    assert.equal(d.tipo, "52", "la carga del andén sale con guía de despacho electrónica");
    assert.ok(/^\d+$/.test(d.folio), `el folio «${d.folio}» no parece un folio ya emitido`);
    assert.ok(d.emisor.includes("-"), "el emisor tiene que ser un RUT");
  }

  // La doble firma del §4.5: el andén libera, el panadero recibe, y las dos firmas quedan.
  const traspasos = await enLaBase(
    `select ct.id::text as id, ct.de_persona_id::text as de, ct.a_persona_id::text as a,
            ct.firma_libero_id::text as libero, ct.firma_recibio_id::text as recibio
       from custody_transfer ct`,
  );
  assert.equal(traspasos.length, manifiestos.length, "quedó carga sin traspasar");
  for (const t of traspasos) {
    assert.ok(t.libero && t.recibio, "un traspaso sin las dos firmas no sostiene ninguna disputa");
    assert.notEqual(t.de, t.a, "el andén y el panadero tienen que ser dos personas distintas");
  }
});

test("[AC-FMIG-26] el encargo creado en ANDÉN consolida en una parada que ya existía, sin agregar paradas", async () => {
  // Lo que hace «de andén» a este encargo hoy es QUIÉN lo creó: el `responsable_carga`, sobre una
  // ruta todavía sin publicar. El evento propio del maestro (`encargo.creado_en_anden`) no existe
  // en `EVENTOS_OPERACION`: lo agrega el AC del flujo del responsable de carga, no este seed.
  const deAnden = await enLaBase(
    `select e.id::text as id, e.bultos, e.destino_id::text as destino_id, u.rol::text as rol
       from encargos e join usuarios u on u.id = e.creado_por_usuario_id
      where u.rol = 'responsable_carga'`,
  );
  assert.equal(deAnden.length, 1, "el §10 pide UN encargo creado en andén");
  assert.equal(deAnden[0].bultos, 7);

  // Consolidó: su destino tiene UNA sola parada de entrega, con dos ítems de dos empresas
  // distintas — que es la razón de ser del piloto B (§3.E1.5).
  const paradas = await enLaBase(
    `select p.id::text as id, count(i.id)::int as items,
            count(distinct i.empresa_cliente_id)::int as empresas
       from paradas p join items i on i.parada_id = p.id
      where p.tipo = 'entrega' and p.destino_id = $1
      group by p.id`,
    [deAnden[0].destino_id],
  );
  assert.equal(paradas.length, 1, "el encargo de andén abrió una parada nueva en vez de consolidar");
  assert.equal(paradas[0].items, 2);
  assert.equal(paradas[0].empresas, 2);
});

test("[AC-FMIG-26] el reintento es un encargo NUEVO encadenado al que no se entregó", async () => {
  const reintentos = await enLaBase(
    `select nuevo.id::text as id, nuevo.bultos, nuevo.estado::text as estado,
            to_char(nuevo.fecha_servicio, 'YYYY-MM-DD') as fecha,
            viejo.id::text as viejo_id, viejo.estado::text as estado_viejo,
            viejo.bultos as bultos_viejo, viejo.destino_id::text as destino_viejo,
            nuevo.destino_id::text as destino_nuevo
       from encargos nuevo join encargos viejo on viejo.id = nuevo.reintento_de`,
  );
  assert.equal(reintentos.length, 1, "el §10 pide UN reintento");
  const r = reintentos[0];
  // El original NO se reabre: su día de fracaso es justo el dato de la disputa (§4.5).
  assert.equal(r.estado_viejo, "no_entregado");
  assert.notEqual(r.id, r.viejo_id);
  assert.equal(r.bultos, r.bultos_viejo, "el reintento lleva la misma carga que no llegó");
  assert.equal(r.destino_nuevo, r.destino_viejo);
  assert.equal(r.fecha, "2026-03-04", "el reintento sale al día siguiente, no el mismo día");

  const [evento] = await enLaBase(
    `select count(*)::int as n from eventos e join evento_tipo t on t.id = e.tipo_id
      where t.codigo = 'encargo.reintentado'`,
  );
  assert.equal(evento.n, 1, "el reintento no dejó su evento de acto humano");
});

test("[AC-FMIG-26] las dos rutas cerraron con la ecuación CUADRADA — y un bulto de menos la pone roja", async () => {
  const dias = await enLaBase(
    "select id::text as id, nombre from rutas where not es_maestra order by nombre",
  );
  assert.equal(dias.length, 2);

  // La ecuación la calcula `ecuacion_de_cierre()` (0045) y no una suma repetida acá: `cargado =
  // entregado + devuelto + faltante` para CADA panadería de cada ruta.
  for (const dia of dias) {
    const renglones = await enLaBase("select * from ecuacion_de_cierre($1)", [dia.id]);
    assert.ok(renglones.length > 0, `«${dia.nombre}» no dejó ningún renglón de ecuación`);
    for (const r of renglones) {
      assert.equal(
        Number(r.diferencia),
        0,
        `«${dia.nombre}» no cuadró para ${r.empresa}: ${r.cargado} ≠ ${r.entregado}+${r.devuelto}+${r.faltante}`,
      );
      assert.ok(Number(r.cargado) > 0, `${r.empresa} cerró con 0 bultos cargados: no hubo andén`);
    }
    const [cerrada] = await enLaBase("select count(*)::int as n from cierres_ruta where ruta_id = $1", [
      dia.id,
    ]);
    assert.equal(cerrada.n, 1, `«${dia.nombre}» quedó sin cerrar`);
  }

  // Lo que volvió al andén está CLASIFICADO como devolución con su motivo de catálogo
  // (AC-FRUT-21): sin motivo, el descuadre existiría pero nadie sabría de qué se trató.
  const [devolucion] = await enLaBase(
    "select bultos, motivo_id::text as motivo_id from devoluciones",
  );
  assert.ok(devolucion, "la mercadería que no se entregó tiene que volver como devolución");
  assert.ok(devolucion.motivo_id, "una devolución sin motivo no está clasificada");

  // ── EL MUTANTE: un bulto menos entregado y la ecuación acusa ─────────────────────
  const [victima] = await enLaBase(
    `select i.id::text as id, i.qty_entregada, p.ruta_id::text as ruta_id
       from items i join paradas p on p.id = i.parada_id
      where p.tipo = 'entrega' and coalesce(i.qty_entregada, 0) > 0
      order by i.id limit 1`,
  );
  await enLaBase("update items set qty_entregada = qty_entregada - 1 where id = $1", [victima.id]);
  const mutada = await enLaBase("select * from ecuacion_de_cierre($1)", [victima.ruta_id]);
  assert.equal(
    mutada.filter((r) => Number(r.diferencia) !== 0).length,
    1,
    "quitar un bulto entregado NO puso la ecuación en rojo: el oráculo no serviría de nada",
  );
  await enLaBase("update items set qty_entregada = $2 where id = $1", [
    victima.id,
    victima.qty_entregada,
  ]);
  const repuesta = await enLaBase("select * from ecuacion_de_cierre($1)", [victima.ruta_id]);
  assert.equal(
    repuesta.filter((r) => Number(r.diferencia) !== 0).length,
    0,
    "reponer el bulto no devolvió la ecuación a verde",
  );
});

test("[AC-FMIG-26] un manifiesto SIN DTE sale marcado `item_sin_dte` — art. 55 DL 825", async () => {
  // El mutante se arma por el camino de verdad: encargo nuevo de una panadería nueva, su ítem en
  // la parada de carga, `confirmarManifiesto` para contarlo y `traspasarCustodia` SIN asociar
  // documento. Nada de esto toca las dos rutas ya cerradas del seed.
  const pool = poolDelTenant(b);
  try {
    const sesionAnden = sesionDe(b.operacion.equipo.anden, "responsable_carga");
    const norte = b.operacion.rutas.norte;

    const [empresa] = await enLaBase(
      `insert into empresas_cliente (rut, razon_social) values ($1, $2)
       returning id::text as id`,
      // RUT de la lista congelada (AC-FIDN-21) que las 4 panaderías del seed no usan: el UNIQUE
      // `(tenant_id, rut)` es por base, y repetir uno acá sería chocar con la identidad ya sembrada.
      ["1.111.112-2", `Panadería sin guía ${CENTINELA_B}`],
    );
    const [destino] = await enLaBase(
      "insert into destinos (nombre, comuna) values ($1, 'Renca') returning id::text as id",
      [`Sucursal sin guía ${CENTINELA_B}`],
    );
    const [encargo] = await enLaBase(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 5) returning id::text as id",
      [empresa.id, destino.id],
    );
    const [carga] = await enLaBase(
      "select id::text as id from paradas where ruta_id = $1 and tipo = 'carga'",
      [norte.diaId],
    );
    const [item] = await enLaBase(
      "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 5) returning id::text as id",
      [carga.id, encargo.id],
    );

    const confirmacion = await confirmarManifiesto(pool, sesionAnden, b.slug, {
      paradaId: carga.id,
      empresaClienteId: empresa.id,
      conteos: [{ item_id: item.id, qty_confirmada: 5 }],
      clientUuid: randomUUID(),
      tsDispositivo: new Date().toISOString(),
      tzOffsetMin: -180,
      incompletoConfirmado: false,
      turnoId: norte.turno.id,
      fotoSha256: null,
    });
    assert.equal(confirmacion.items, 1, "el sub-manifiesto del mutante no contó su ítem");

    const traspaso = await traspasarCustodia(pool, sesionAnden, b.slug, {
      turnoId: norte.turno.id,
      manifiestoId: confirmacion.manifiesto_id,
      liberoUsuarioId: b.operacion.equipo.anden.usuarioId,
      liberoPin: "704183",
      recibeUsuarioId: norte.chofer.usuarioId,
      recibePin: "319027",
      sello: null,
      clientUuid: randomUUID(),
      tsDispositivo: new Date().toISOString(),
      tzOffsetMin: -180,
    });
    assert.equal(traspaso.tipo, "ok", `el traspaso rebotó (${traspaso.tipo}) — el §4.2 lo prohíbe`);
    assert.ok(
      traspaso.flags.includes("item_sin_dte"),
      "la carga salió sin documento y NADIE lo marcó: es exactamente lo que el art. 55 DL 825 exige ver",
    );
  } finally {
    await pool.end();
  }
});
