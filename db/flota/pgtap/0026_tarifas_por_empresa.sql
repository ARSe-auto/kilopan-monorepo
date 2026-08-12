-- pgTAP: el catálogo cerrado de tarifas, su tope de 4, y los dos modificadores. [AC-FTAR-01]
--
-- El 422 con su mensaje vive en el servidor que traduce `check_violation` (mismo patrón que
-- AC-FRUT-01). Acá va lo de la base: que el catálogo NO se pueda ampliar con «zona» ni
-- «horario» ni ningún concepto inventado, que el quinto concepto DISTINTO rebote y el cuarto
-- entre, que corregir un concepto ya activo no gaste cupo, y que la sexta zona rebote.

select no_plan();

select has_table(t) from unnest(array['tarifas', 'tarifa_zonas', 'tarifa_recargo_horario']) as t;

select matches(
  obj_description('tarifas'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'tarifas: declara su clase PLANIFICACIÓN (§4.2)'
);
select matches(
  obj_description('tarifa_zonas'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'tarifa_zonas: declara su clase PLANIFICACIÓN (§4.2)'
);
select matches(
  obj_description('tarifa_recargo_horario'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'tarifa_recargo_horario: declara su clase PLANIFICACIÓN (§4.2)'
);

select col_type_is('tarifas', 'precio_clp', 'bigint', 'precio_clp es CLP entero, jamás float (§0, §4.8)');
select col_type_is('tarifa_zonas', 'monto_clp', 'bigint', 'monto_clp de zona es CLP entero (§0)');
select col_type_is(
  'tarifa_recargo_horario', 'monto_clp', 'bigint', 'monto_clp de recargo horario es CLP entero (§0)'
);

-- ─── El fixture ──────────────────────────────────────────────────────────────────────

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
create temporary table e_id as select id as empresa from empresas_cliente limit 1;

-- ─── El catálogo cerrado (§0, §3.E1.8): SOLO los cinco, nunca «zona» ni «horario» ───────

insert into tarifas (empresa_cliente_id, concepto, precio_clp)
  select empresa, 'por_entrega', 3500 from e_id;
select is(
  (select count(*)::int from tarifas), 1, 'un concepto del catálogo entra sin rebotar'
);

select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp)
     select empresa, 'zona', 1000 from e_id $$,
  '23514', null,
  '«zona» no es un concepto del catálogo — es un modificador (§7.5 anti-ancla)'
);
select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp)
     select empresa, 'horario', 1000 from e_id $$,
  '23514', null,
  '«horario» no es un concepto del catálogo — es un modificador (§7.5 anti-ancla)'
);
select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp)
     select empresa, 'recargo_combustible', 1000 from e_id $$,
  '23514', null,
  'ningún recargo por combustible/energía indexado existe en el catálogo (§7.5 anti-ancla)'
);
select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp)
     select empresa, 'concepto_inventado', 1000 from e_id $$,
  '23514', null,
  'un concepto fuera del catálogo cerrado de 5 rebota (§0)'
);
select is(
  (select count(*)::int from tarifas), 1, 'ningún concepto fuera del catálogo dejó fila (0 filas)'
);

select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp)
     select empresa, 'por_bulto', -100 from e_id $$,
  '23514', null,
  'un precio negativo no es un descuento: es un dato cargado mal'
);

-- ─── Máx 4 conceptos DISTINTOS activos por empresa (§0) ─────────────────────────────────

insert into tarifas (empresa_cliente_id, concepto, precio_clp) select empresa, 'por_bulto', 500 from e_id;
insert into tarifas (empresa_cliente_id, concepto, precio_clp)
  select empresa, 'por_devolucion', 800 from e_id;
insert into tarifas (empresa_cliente_id, concepto, precio_clp)
  select empresa, 'por_intento_fallido', 1200 from e_id;
select is(
  (select count(distinct concepto)::int from tarifas where empresa_cliente_id = (select empresa from e_id)),
  4,
  'los cuatro conceptos activos que permite el tope entraron'
);

select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp)
     select empresa, 'por_bloque_horas', 45000 from e_id $$,
  '23514', null,
  'el quinto concepto DISTINTO rebota: el §0 fija el tope en TARIFAS.activos_max_por_empresa'
);
select is(
  (select count(distinct concepto)::int from tarifas where empresa_cliente_id = (select empresa from e_id)),
  4,
  'el tope sigue en 4 tras el rebote — 0 filas del quinto concepto'
);

-- Corregir un concepto YA activo (vigencia nueva, AC-FTAR-02) no gasta cupo: no es un concepto
-- nuevo, es una fila nueva del mismo concepto.
insert into tarifas (empresa_cliente_id, concepto, precio_clp)
  select empresa, 'por_entrega', 3800 from e_id;
select is(
  (select count(*)::int from tarifas
    where empresa_cliente_id = (select empresa from e_id) and concepto = 'por_entrega'),
  2,
  'una segunda fila del MISMO concepto entra: el tope cuenta conceptos distintos, no filas'
);
select is(
  (select count(distinct concepto)::int from tarifas where empresa_cliente_id = (select empresa from e_id)),
  4,
  'el tope de conceptos distintos sigue en 4 después de la corrección'
);

-- ─── Zonas: modificador de `por_entrega`, máximo 5 por empresa ──────────────────────────

insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp)
  select empresa, 'Zona ' || g, array['Comuna ' || g], 500 * g
  from e_id, generate_series(1, 5) as g;
select is((select count(*)::int from tarifa_zonas), 5, 'las cinco zonas que permite el tope entraron');

select throws_ok(
  $$ insert into tarifa_zonas (empresa_cliente_id, nombre, comunas)
     select empresa, 'Zona 6', array['Comuna 6'] from e_id $$,
  '23514', null,
  'la sexta zona rebota: el §0 fija máximo 5'
);
select is((select count(*)::int from tarifa_zonas), 5, 'el tope de zonas sigue en 5 tras el rebote');

select throws_ok(
  $$ insert into tarifa_zonas (empresa_cliente_id, nombre, comunas)
     select empresa, 'Zona sin comunas', array[]::text[] from e_id $$,
  '23514', null,
  'una zona sin comunas no delimita nada'
);

-- ─── Recargo horario: el otro modificador, jamás un concepto del catálogo ───────────────

insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp)
  select empresa, '20:00', '23:59', 1000 from e_id;
select is(
  (select count(*)::int from tarifa_recargo_horario), 1, 'el recargo horario entra como modificador'
);
select throws_ok(
  $$ insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp)
     select empresa, '20:00', '20:00', 1000 from e_id $$,
  '23514', null,
  'una franja horaria vacía no delimita nada'
);

select finish();
