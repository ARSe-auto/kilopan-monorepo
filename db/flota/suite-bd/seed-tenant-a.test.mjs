#!/usr/bin/env node
// El tenant A «e-auto DaaS» del seed §10, entero [AC-FMIG-25] —
// specs/flota/08-diseno-miga-onboarding.md §7, §10 del maestro.
//
// Mitad partida de AC-FMIG-18, que cerró sobre B, C y el oráculo de cruce. Lo que este test
// verifica es que el seed dejó cada cosa que el §10 le pide al tenant grande, contado contra la
// BASE y no contra lo que la función devolvió: un seed que se aserta a sí mismo por su valor de
// retorno no prueba que las filas quedaran escritas.
//
// ─── LO QUE NO SE ASERTA, Y NO ES UN OLVIDO ──────────────────────────────────────────
//
// `otd_comprometido_pct` de la farmacia (§4.5, §3.E1.11, §10) NO tiene aserción de VALOR porque
// la columna NO EXISTE: la declara la spec 06 como AC-FTAR-13, abierto, y el motor jamás crea ni
// edita migraciones (AGENTS.md). Lo que sí se aserta es esa AUSENCIA, y a propósito: el día que
// una sesión supervisada cree la columna, este test se pone ROJO y obliga a sembrar el 95 de la
// farmacia en vez de dejar la tarjeta SLA del camino dorado de A apagada para siempre en
// silencio. Un `skip` no haría eso; una aserción invertida sí.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con } from "../conectar.mjs";
import { sembrarTenantA, EV48, CENTINELA_A } from "../seeds/tenant-a.mjs";

const SLUG = "gate_seed_a";
let a;

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  a = await sembrarTenantA(SLUG, { recrear: true });
});

const enLaBase = (texto, params = []) => con(a.bd, ({ sql }) => sql(texto, params));
const una = async (texto, params = []) => (await enLaBase(texto, params))[0];

test("[AC-FMIG-25] 3 EV48 con la ficha del §10 y la autonomía REAL del Anexo A, no la del folleto", async () => {
  const filas = await enLaBase(
    `select patente, capacidad_bultos, bateria_wh, autonomia_nominal_km, soh_pct
       from vehiculos order by patente`,
  );
  assert.equal(filas.length, 3, "el §10 pide 3 EV48 en el tenant A");
  for (const v of filas) {
    assert.equal(v.capacidad_bultos, EV48.capacidad_bultos, `${v.patente} sin los 90 bultos del §10`);
    assert.equal(v.bateria_wh, EV48.bateria_wh, `${v.patente} sin los 41.860 Wh del §10`);
    // El Anexo A prohíbe planificar con los 305 km CLTC del folleto: el rango real es 185–245.
    assert.equal(v.autonomia_nominal_km, 185, `${v.patente} no lleva el piso REAL de autonomía`);
    assert.notEqual(v.autonomia_nominal_km, 305, `${v.patente} quedó sembrado con el folleto`);
  }
});

test("[AC-FMIG-25] 6 usuarios: la dueña más los cinco roles del §5.4, cada uno con su persona", async () => {
  const filas = await enLaBase(
    "select rol, count(*)::int as n from usuarios where rol <> 'cliente' group by rol order by rol",
  );
  const porRol = Object.fromEntries(filas.map((f) => [f.rol, f.n]));
  assert.deepEqual(
    porRol,
    { admin_tenant: 1, chofer: 2, operador: 1, responsable_carga: 1, responsable_tecnico: 1 },
    "el §10 pide admin + operador + 2 choferes + responsable_carga + responsable_tecnico",
  );

  // Los cinco invitables entraron por el camino de verdad (invitación + solicitud + aprobación en
  // 1 toque, §5.4): si el seed hubiera escrito las filas a mano, no habría solicitudes aprobadas.
  const { n } = await una("select count(*)::int as n from solicitudes_acceso where estado = 'aprobada'");
  assert.equal(n, 5, "los 5 roles invitables tienen que nacer de una solicitud APROBADA, no de un insert");
});

test("[AC-FMIG-25] 3 contratantes con su concepto del catálogo cerrado y su usuario `cliente`", async () => {
  const filas = await enLaBase(
    `select ec.razon_social, ec.rut, t.concepto, t.precio_clp::int as precio_clp,
            (select count(*)::int from usuarios u
              where u.empresa_cliente_id = ec.id and u.rol = 'cliente') as clientes
       from empresas_cliente ec join tarifas t on t.empresa_cliente_id = ec.id
      order by t.precio_clp desc`,
  );
  assert.equal(filas.length, 3, "el §10 pide 3 empresas contratantes con su concepto");
  assert.deepEqual(
    filas.map((f) => [f.concepto, f.precio_clp]),
    [
      ["por_bloque_horas", 45000],
      ["por_entrega", 3500],
      ["por_bulto", 1200],
    ],
    "los conceptos y precios del §10: farmacia por bloque, distribuidora por entrega, minimarket por bulto",
  );
  for (const f of filas) {
    assert.equal(f.clientes, 1, `«${f.razon_social}» tiene que tener EXACTAMENTE 1 usuario cliente`);
    assert.ok(f.razon_social.includes(CENTINELA_A), `«${f.razon_social}» sin el centinela del tenant`);
  }
});

test("[AC-FMIG-25] la tarjeta SLA de la farmacia sigue BLOQUEADA por esquema: `otd_comprometido_pct` no existe", async () => {
  const columna = await una(
    `select a.attname from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tarifas' and a.attname = 'otd_comprometido_pct'
        and a.attnum > 0 and not a.attisdropped`,
  );
  assert.equal(
    columna,
    undefined,
    "`otd_comprometido_pct` YA EXISTE: AC-FTAR-13 se cerró y el seed del tenant A tiene que " +
      "cargar el 95 de la farmacia (§10) — hasta que lo haga, la tarjeta SLA del camino dorado " +
      "de A queda apagada y este rojo es el que lo dice",
  );
});

test("[AC-FMIG-25] 25 destinos es-CL con su comuna", async () => {
  const filas = await enLaBase("select nombre, comuna from destinos order by nombre");
  assert.equal(filas.length, 25, "el §10 pide 25 destinos");
  for (const d of filas) {
    assert.ok(d.comuna, `«${d.nombre}» sin comuna: `.concat("`modificadores_de_entrega()` la necesita para la zona"));
    assert.ok(d.nombre.includes(CENTINELA_A), `«${d.nombre}» sin el centinela del tenant`);
  }
});

test("[AC-FMIG-25] una semana de agenda con la recarga AC NOCTURNA de los 3 vehículos", async () => {
  const bloques = await enLaBase(
    `select vehiculo_id::text as vehiculo_id,
            extract(hour from empieza_en at time zone 'America/Santiago')::int as entra,
            extract(hour from termina_en at time zone 'America/Santiago')::int as sale
       from bloques_agenda where tipo = 'recarga' order by empieza_en`,
  );
  assert.equal(bloques.length, 21, "7 noches × 3 vehículos: la semana del §10");
  assert.equal(new Set(bloques.map((b) => b.vehiculo_id)).size, 3, "la semana es de los TRES EV48");
  for (const b of bloques) {
    // Nocturna de verdad: entra de noche y sale de madrugada. Una «recarga nocturna» a mediodía
    // sería una fila que dice una cosa y significa otra, y el §10 la pide para que el tablero de
    // energía tenga una ventana real que mirar.
    assert.ok(b.entra >= 21 || b.entra <= 1, `bloque de recarga que entra a las ${b.entra}: no es nocturno`);
    assert.ok(b.sale >= 3 && b.sale <= 7, `bloque de recarga que sale a las ${b.sale}: no es de madrugada`);
  }
});

test("[AC-FMIG-25] la ruta del día consolida encargos de las 3 empresas, con no-entrega y parcial", async () => {
  const empresas = await una(
    `select count(distinct i.empresa_cliente_id)::int as n
       from items i join paradas p on p.id = i.parada_id
      where p.ruta_id = $1`,
    [a.ruta.id],
  );
  assert.equal(empresas.n, 3, "el §10 pide la ruta del día CONSOLIDADA de las 3 empresas");

  const pods = await enLaBase(
    "select resultado, count(*)::int as n from entregas_pod where cerrada group by resultado order by resultado",
  );
  const porResultado = Object.fromEntries(pods.map((p) => [p.resultado, p.n]));
  assert.equal(porResultado.fallo, 1, "el §10 pide 1 no-entrega en el día de A");
  assert.equal(porResultado.parcial, 1, "el §10 pide 1 parcial en el día de A");
  assert.equal(porResultado.exito, 7, "las otras 7 paradas del día cerraron bien");

  // La no-entrega SIN motivo de catálogo no es una no-entrega clasificada, es un agujero.
  const { n } = await una(
    "select count(*)::int as n from entregas_pod where resultado = 'fallo' and motivo_id is not null",
  );
  assert.equal(n, 1, "la no-entrega tiene que llevar su motivo del catálogo del vertical");
});

test("[AC-FMIG-25] el cierre del día: 1 devolución materializada y 1 descuadre clasificado", async () => {
  const devolucion = await una(
    "select bultos, motivo_id::text as motivo_id from devoluciones",
  );
  assert.ok(devolucion, "el §10 pide 1 devolución en el día de A");
  assert.equal(devolucion.bultos, 3);
  assert.ok(devolucion.motivo_id, "una devolución sin motivo no está clasificada");

  // El descuadre es CLASIFICADO: lo que la clasificación táctil asignó a `devuelto` y a
  // `faltante` (§5.2 F5) queda escrito, y la ecuación de la BD —no una suma repetida acá— es la
  // que dice que no cuadra.
  const renglones = await enLaBase("select * from ecuacion_de_cierre($1)", [a.ruta.id]);
  const descuadrados = renglones.filter((r) => Number(r.diferencia) !== 0);
  assert.equal(descuadrados.length, 1, `el §10 pide 1 descuadre; la ecuación dio ${descuadrados.length}`);
  assert.equal(Number(descuadrados[0].devuelto), 3);
  assert.equal(Number(descuadrados[0].faltante), 2);
  assert.ok(
    a.cierre.flags.includes("cierre_descuadrado"),
    "el cierre entró (regla de oro, §4.2) pero tiene que quedar MARCADO como descuadrado",
  );
});

test("[AC-FMIG-25] 3 liquidaciones semanales: cerrada con folio registrado, disputada por línea, pagada", async () => {
  const liquidaciones = await enLaBase(
    `select estado, periodo_inicio::text as inicio, periodo_fin::text as fin,
            (select count(*)::int from liquidacion_lineas l where l.liquidacion_id = q.id) as lineas
       from liquidaciones q order by estado, inicio`,
  );
  assert.equal(liquidaciones.length, 3, "el §10 pide 3 liquidaciones semanales");
  for (const q of liquidaciones) {
    const dias = (Date.parse(q.fin) - Date.parse(q.inicio)) / 86_400_000;
    assert.equal(dias, 6, `el período ${q.inicio}..${q.fin} no es una SEMANA`);
  }
  assert.deepEqual(
    liquidaciones.map((q) => q.estado).sort(),
    ["cerrada", "cerrada", "pagada"],
    "una pagada y dos cerradas: la disputada es una cerrada con su línea disputada (AC-FTAR-06)",
  );

  // El folio de la factura ya emitida: REGISTRADO como documento de tercero, jamás generado
  // (art. 97 N°4 CT). Si algún día apareciera una secuencia de folios propia, esta aserción no
  // la vería — pero la tabla donde vive el número es la misma que la del DTE tecleado en el
  // andén, y esa es la evidencia de que la app solo registra.
  const documento = await una("select tipo::text as tipo, folio, emisor from reference_document");
  assert.ok(documento, "la liquidación cerrada del §10 va con su folio ya registrado");
  assert.equal(documento.tipo, "33");
  assert.equal(documento.folio, "8814023");

  // La disputa por línea, con su autor `cliente` y su motivo de catálogo.
  const disputada = await una(
    `select l.disputa_estado, l.disputa_motivo_id::text as motivo_id, u.rol as autor_rol
       from liquidacion_lineas l join usuarios u on u.id = l.disputa_autor_id
      where l.disputa_estado is not null`,
  );
  assert.ok(disputada, "el §10 pide 1 liquidación DISPUTADA por línea");
  assert.equal(disputada.disputa_estado, "abierta");
  assert.equal(disputada.autor_rol, "cliente", "la disputa la abre el contratante, no la flota");
  assert.ok(disputada.motivo_id, "una disputa sin motivo de catálogo no es disputable");
});
