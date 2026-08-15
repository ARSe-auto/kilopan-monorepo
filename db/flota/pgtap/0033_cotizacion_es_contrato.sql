-- pgTAP: cotización = contrato — borrador simula, «Aceptar» se vuelve v1 sin re-digitación,
-- >4 activos rebota, y el borrador jamás genera líneas. [AC-FTAR-11]
--
-- Fuente: §3.E1.8 (spec 06 §4) — ver el razonamiento completo en la migración 0067.

select no_plan();

select has_table('cotizaciones', 'la cabecera del borrador (§3.E1.8)');
select has_table('cotizacion_tarifas', 'las líneas de precio hipotético del borrador');
select has_table('cotizacion_volumenes', 'los volúmenes hipotéticos, jamás evidencia');
select matches(
  obj_description('cotizaciones'::regclass, 'pg_class'), '^PLANIFICACIÓN',
  'cotizaciones declara su clase PLANIFICACIÓN (§4.2)'
);
select matches(
  obj_description('cotizacion_tarifas'::regclass, 'pg_class'), '^PLANIFICACIÓN',
  'cotizacion_tarifas declara su clase PLANIFICACIÓN (§4.2)'
);
select col_type_is(
  'cotizacion_tarifas', 'precio_clp', 'bigint', 'precio_clp del borrador es CLP entero (§0, §4.8)'
);

-- ─── El fixture ────────────────────────────────────────────────────────────────────────

-- Mismo RUT congelado que usan 0026/0027/0028/0031 (§7.8): la suite corre en su propia
-- transacción con rollback (db/flota/pgtap.mjs), así que compartirlo entre suites pgTAP no
-- choca con nada — solo los fixtures e2e (persistentes) necesitan uno EXCLUSIVO.
insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
create temporary table e_id as select id as empresa from empresas_cliente where rut = '76.111.111-6';

-- ─── La simulación: MISMA lógica de redondeo del devengo, sobre volúmenes hipotéticos ──────

insert into cotizaciones (empresa_cliente_id) select empresa from e_id;
create temporary table c_id as select id as cotizacion from cotizaciones limit 1;

insert into cotizacion_tarifas (cotizacion_id, empresa_cliente_id, concepto, precio_clp)
  select c.cotizacion, e.empresa, 'por_entrega', 3500 from c_id c, e_id e;
insert into cotizacion_tarifas (cotizacion_id, empresa_cliente_id, concepto, precio_clp)
  select c.cotizacion, e.empresa, 'por_bulto', 800 from c_id c, e_id e;

insert into cotizacion_volumenes (cotizacion_id, empresa_cliente_id, concepto, cantidad)
  select c.cotizacion, e.empresa, 'por_entrega', 120 from c_id c, e_id e;
insert into cotizacion_volumenes (cotizacion_id, empresa_cliente_id, concepto, cantidad)
  select c.cotizacion, e.empresa, 'por_bulto', 340 from c_id c, e_id e;

select is(
  (select simular_cotizacion(cotizacion) from c_id),
  (3500 * 120 + 800 * 340)::bigint,
  'el total simulado es la suma de round_clp(precio × volumen hipotético) por concepto'
);

select is(
  (select count(*)::int from liquidacion_lineas),
  0,
  'simular NUNCA toca liquidacion_lineas: el borrador no es evidencia'
);

-- Un concepto con volumen pero SIN precio en el borrador no aporta al total: no hay negocio
-- del que inventar un monto (mismo espíritu que «evidencia sin tarifa vigente», §3 spec 06).
insert into cotizacion_volumenes (cotizacion_id, empresa_cliente_id, concepto, cantidad)
  select c.cotizacion, e.empresa, 'por_devolucion', 5 from c_id c, e_id e;
select is(
  (select simular_cotizacion(cotizacion) from c_id),
  (3500 * 120 + 800 * 340)::bigint,
  'un concepto sin precio cargado en el borrador no suma al total simulado'
);

-- ─── «Aceptar»: el MISMO borrador se vuelve v1, sin re-digitación ──────────────────────────

select is(
  (select count(*)::int from tarifas t join c_id c on true
    where t.id in (select id from cotizacion_tarifas where cotizacion_id = c.cotizacion)),
  0,
  'antes de aceptar, ningún id del borrador vive todavía en tarifas'
);

create temporary table ids_borrador as
  select id, concepto, precio_clp from cotizacion_tarifas
   where cotizacion_id = (select cotizacion from c_id);

select lives_ok(
  $$ select aceptar_cotizacion((select cotizacion from c_id)) $$,
  'aceptar un borrador dentro del tope de conceptos no rebota'
);

select is(
  (select estado from cotizaciones where id = (select cotizacion from c_id)),
  'aceptada',
  'la cotización queda en estado terminal aceptada'
);
select isnt(
  (select aceptada_en from cotizaciones where id = (select cotizacion from c_id)),
  null,
  'aceptada_en queda registrado'
);

select bag_eq(
  $$ select id, concepto, precio_clp from tarifas
      where id in (select id from ids_borrador) $$,
  $$ select id, concepto, precio_clp from ids_borrador $$,
  'las MISMAS filas del borrador (mismo id, mismo concepto, mismo precio) ahora son vigencias — cero re-digitación'
);

select is(
  (select count(*)::int from liquidacion_lineas),
  0,
  'aceptar tampoco toca liquidacion_lineas: ni el borrador ni su aceptación son evidencia'
);

select throws_ok(
  $$ select aceptar_cotizacion((select cotizacion from c_id)) $$,
  '23514',
  null,
  'aceptar una cotización ya aceptada rebota: aceptar es terminal'
);

-- ─── >4 conceptos activos ⇒ 422 (check_violation) y 0 filas ────────────────────────────────
--
-- La empresa de este fixture ya tiene 2 conceptos activos (por_entrega, por_bulto, recién
-- aceptados). Un segundo borrador con 3 conceptos NUEVOS —bloque_horas, devolución, intento
-- fallido— dejaría 5 conceptos DISTINTOS activos: el tercero de los tres rebota, y con él
-- rebota la función entera.

insert into cotizaciones (empresa_cliente_id) select empresa from e_id;
create temporary table c2_id as select id as cotizacion from cotizaciones
  where empresa_cliente_id = (select empresa from e_id) and estado = 'borrador';

insert into cotizacion_tarifas (cotizacion_id, empresa_cliente_id, concepto, precio_clp)
  select c.cotizacion, e.empresa, 'por_bloque_horas', 45000 from c2_id c, e_id e;
insert into cotizacion_tarifas (cotizacion_id, empresa_cliente_id, concepto, precio_clp)
  select c.cotizacion, e.empresa, 'por_devolucion', 1200 from c2_id c, e_id e;
insert into cotizacion_tarifas (cotizacion_id, empresa_cliente_id, concepto, precio_clp)
  select c.cotizacion, e.empresa, 'por_intento_fallido', 900 from c2_id c, e_id e;

select is(
  (select count(distinct concepto)::int from tarifas where empresa_cliente_id = (select empresa from e_id)),
  2,
  'la empresa arranca este bloque con exactamente 2 conceptos activos (el borrador anterior, ya aceptado)'
);

select throws_ok(
  $$ select aceptar_cotizacion((select cotizacion from c2_id)) $$,
  '23514',
  null,
  'aceptar un borrador que dejaría 5 conceptos distintos activos rebota con check_violation (422)'
);

select is(
  (select count(distinct concepto)::int from tarifas where empresa_cliente_id = (select empresa from e_id)),
  2,
  '0 filas: el rebote a mitad de la función revierte todo lo que alcanzó a insertar, no deja una aceptación parcial'
);

select is(
  (select estado from cotizaciones where id = (select cotizacion from c2_id)),
  'borrador',
  'la cotización que rebotó sigue siendo borrador: no quedó a medio aceptar'
);

select is(
  (select count(*)::int from liquidacion_lineas),
  0,
  'ni siquiera el rebote de >4 activos generó una línea de liquidación'
);

select finish();
