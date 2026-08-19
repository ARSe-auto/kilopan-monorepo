-- pgTAP: estructura de `vertical_template`, `grupos` y `parametros` (§4.4). [AC-FTEN-12]
--
-- Estructura, no conducta: qué columnas hay, de qué tipo, y los DOS invariantes que el AC
-- pide como caso de rebote — un ciclo en el árbol de grupos, y un vertical sembrado sin
-- `meta_eevd`.

select no_plan();

-- --- vertical_template -----------------------------------------------------------------
select has_table('vertical_template');
select has_column('vertical_template', 'vertical');
select has_column('vertical_template', 'terminologia');
select has_column('vertical_template', 'motivos');
select has_column('vertical_template', 'checklists');
select has_column('vertical_template', 'cargo_types');
select has_column('vertical_template', 'config_ev');
select has_column('vertical_template', 'meta_eevd');

select col_type_is('vertical_template', 'motivos', 'text[]',
  'motivos es una lista plana de códigos');
select col_type_is('vertical_template', 'cargo_types', 'text[]',
  'cargo_types es una lista plana de códigos');
select col_type_is('vertical_template', 'terminologia', 'jsonb',
  'la terminología del vertical es estructurada');
select col_not_null('vertical_template', 'meta_eevd',
  'la meta EEVD vive como COLUMNA obligatoria por vertical, jamás en prosa (§2)');

-- CASO DE REBOTE del AC: un vertical sembrado sin meta EEVD no entra.
select throws_ok(
  $$ insert into vertical_template (vertical) values ('panaderia_sin_meta') $$,
  '23502',
  null,
  'un vertical sembrado sin meta_eevd rebota en la BD'
);

select lives_ok(
  $$ insert into vertical_template (vertical, meta_eevd) values ('panaderia', 18) $$,
  'con su meta, el vertical entra'
);

select throws_ok(
  $$ insert into vertical_template (vertical, meta_eevd) values ('panaderia', 20) $$,
  '23505',
  null,
  'el mismo vertical dos veces en el mismo tenant rebota'
);

-- --- grupos: árbol ÚNICO sin ciclos ------------------------------------------------------
select has_table('grupos');
select has_column('grupos', 'padre_id');

select lives_ok(
  $$ insert into grupos (id, nombre, padre_id) values
       ('019fe100-0000-7000-8000-000000000001', 'norte', null),
       ('019fe100-0000-7000-8000-000000000002', 'norte-a', '019fe100-0000-7000-8000-000000000001'),
       ('019fe100-0000-7000-8000-000000000003', 'norte-a-1', '019fe100-0000-7000-8000-000000000002') $$,
  'una rama de tres niveles entra sin problema'
);

-- CASO DE REBOTE del AC, en sus tres formas — las tres son ciclos y ninguna la atrapa una FK,
-- porque cada fila por separado es perfectamente válida.
select throws_ok(
  $$ update grupos set padre_id = '019fe100-0000-7000-8000-000000000001'
      where id = '019fe100-0000-7000-8000-000000000001' $$,
  '23514',
  null,
  'un grupo que es su propio padre rebota'
);

select throws_ok(
  $$ update grupos set padre_id = '019fe100-0000-7000-8000-000000000002'
      where id = '019fe100-0000-7000-8000-000000000001' $$,
  '23514',
  null,
  'un ciclo de dos saltos rebota'
);

select throws_ok(
  $$ update grupos set padre_id = '019fe100-0000-7000-8000-000000000003'
      where id = '019fe100-0000-7000-8000-000000000001' $$,
  '23514',
  null,
  'un ciclo de tres saltos rebota: el recorrido sube la rama entera'
);

-- Y mover una rama a otro lugar VÁLIDO sigue funcionando: el guard no es un no-op al revés.
select lives_ok(
  $$ insert into grupos (id, nombre) values ('019fe100-0000-7000-8000-000000000004', 'sur');
     update grupos set padre_id = '019fe100-0000-7000-8000-000000000004'
      where id = '019fe100-0000-7000-8000-000000000002' $$,
  'reparentar una rama a un nodo que no es su descendiente sigue permitido'
);

-- --- parametros: una sola fila, y el dinero en bigint -------------------------------------
select has_table('parametros');
select col_type_is('parametros', 'tarifa_kwh_clp', 'bigint',
  'el dinero es CLP bigint entero, jamás numeric ni float (§0, §4.8)');
select col_type_is('parametros', 'precio_diesel_litro_clp', 'bigint',
  'el dinero es CLP bigint entero, jamás numeric ni float (§0, §4.8)');
select has_column('parametros', 'reserva_pct');
select has_column('parametros', 'factor_consumo');
select has_column('parametros', 'bultos_max_sin_receptor');

-- `factor_consumo` es el OVERRIDE del tenant (§0: «factor_consumo 0,85 y override en
-- parametros»). Nullable, y SIN el número copiado al DDL: el valor canónico vive una sola vez
-- en la familia de constantes, y duplicarlo acá es lo que el grep-gate de AC-FTEN-01 atrapa.
select col_is_null('parametros', 'factor_consumo',
  'factor_consumo es el override del tenant: NULL significa «usar el canónico»');
select is(
  (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'parametros'::regclass and a.attname = 'factor_consumo'),
  null,
  'el DDL no hornea el factor de consumo: no hay DEFAULT que duplique la constante'
);

select lives_ok(
  $$ insert into parametros (tarifa_kwh_clp, precio_diesel_litro_clp) values (145, 1210) $$,
  'la fila de parámetros del tenant entra'
);

select throws_ok(
  $$ insert into parametros (tarifa_kwh_clp) values (200) $$,
  '23505',
  null,
  'una SEGUNDA fila de parámetros rebota: «por tenant» es «una fila» en una BD por tenant'
);

select throws_ok(
  $$ update parametros set reserva_pct = 120 $$,
  '23514',
  null,
  'un porcentaje de reserva fuera de 0–100 rebota'
);

-- La lista CERRADA de 8 claves para E1, dictada por el dueño el 09-ago-2026
-- (docs/respuestas-dueno-2026-08-09.md §P5). Están las OCHO y ninguna de más.
select bag_eq(
  $$ select a.attname::text from pg_attribute a
      where a.attrelid = 'parametros'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('id', 'tenant_id', 'unica') $$,
  $$ values ('reserva_pct'), ('factor_consumo'), ('tarifa_kwh_clp'),
            ('precio_diesel_litro_clp'), ('bultos_max_sin_receptor'),
            ('anticipacion_vencimiento_dias'), ('tolerancia_eta_minutos'),
            ('periodicidad_liquidacion') $$,
  'parametros tiene exactamente las 8 claves de la lista cerrada de E1 (P5)'
);

-- Consecuencia 1 de P5: el cero es el valor DICTADO («siempre foto»), no un vacío. El CHECK
-- de la 0003 exigía > 0 y habría rebotado justo el valor que el dueño eligió.
select lives_ok(
  $$ update parametros set bultos_max_sin_receptor = 0 $$,
  'bultos_max_sin_receptor = 0 es legítimo: significa «ningún bulto sin encuadre»'
);

-- Consecuencia 3 de P5: el piso de 15 min del Anexo B vive en el esquema; el valor, en el seed.
select lives_ok(
  $$ update parametros set tolerancia_eta_minutos = 20 $$,
  'la tolerancia dictada (20 min) entra'
);
select throws_ok(
  $$ update parametros set tolerancia_eta_minutos = 10 $$,
  '23514',
  null,
  'una tolerancia por debajo del mínimo de 15 min del Anexo B rebota en la BD'
);

select is(
  (select periodicidad_liquidacion from parametros),
  'semanal',
  'la periodicidad de liquidación nace en «semanal», el default que dictó el dueño'
);

select * from finish();
