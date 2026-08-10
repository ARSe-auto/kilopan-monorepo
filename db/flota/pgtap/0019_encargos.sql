-- pgTAP: el encargo, sus dos rebotes y el enum que NO se inventó. [AC-FRUT-01]
--
-- El 422 con su mensaje vive en el e2e. Acá va lo de la base: el rango de bultos, la caja de
-- Chile de los destinos, la validación de `attrs` contra la definición vigente, y —lo que más
-- vale— que el enum de estados tenga SOLO los dos valores que el maestro fija, porque la
-- pregunta 1 de la spec 03 sigue abierta.

select no_plan();

select has_table(t) from unnest(array['empresas_cliente', 'destinos', 'encargos']) as t;

-- El enum de estados NO se inventó: solo los dos que el texto fija. Si mañana aparecen más sin
-- que el dueño haya respondido la pregunta 1, este test lo dice.
select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'encargo_estado'),
  array['aceptado', 'solicitado'],
  'el enum de estados tiene los DOS del maestro: los intermedios los agrega AC-FRUT-03'
);

-- El de `geo_confianza`, en cambio, va COMPLETO aunque E1 solo produzca dos: es del §4.5.
select is(
  (select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'geo_confianza'),
  4,
  'geo_confianza lleva sus cuatro valores del §4.5, aunque el geocoding sea E2'
);

select matches(
  obj_description('encargos'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'encargos: declara su clase PLANIFICACIÓN (§4.2) — acá SÍ se rebota'
);

-- ─── El fixture ──────────────────────────────────────────────────────────────────────

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
insert into destinos (nombre) values ('Local del centro');

create temporary table e_ids as
  select (select id from empresas_cliente limit 1) as empresa,
         (select id from destinos limit 1) as destino;

insert into encargos (empresa_cliente_id, destino_id, bultos)
  select empresa, destino, 12 from e_ids;

-- Los tres defaults que hacen posible el alta de tres datos (§3.E1.5).
select is(
  (select fecha_servicio from encargos limit 1),
  (now() at time zone 'America/Santiago')::date,
  'la fecha de servicio nace HOY, en el día de Chile'
);
select is((select attrs from encargos limit 1), '{}'::jsonb, '`attrs` nace vacío');
select is(
  (select estado::text from encargos limit 1),
  'aceptado',
  'el encargo que no crea el contratante nace aceptado: la aceptación es del operador (§3.E1.10)'
);

-- ─── Los bordes de bultos (§4.5) ────────────────────────────────────────────────────

insert into encargos (empresa_cliente_id, destino_id, bultos) select empresa, destino, 1 from e_ids;
insert into encargos (empresa_cliente_id, destino_id, bultos) select empresa, destino, 500 from e_ids;

select throws_ok(
  $$ insert into encargos (empresa_cliente_id, destino_id, bultos)
     select empresa, destino, 0 from e_ids $$,
  '23514', null,
  'un encargo de cero bultos no es un encargo'
);
select throws_ok(
  $$ insert into encargos (empresa_cliente_id, destino_id, bultos)
     select empresa, destino, 501 from e_ids $$,
  '23514', null,
  'más de 500 bultos es un camión entero, no un encargo (§4.5)'
);

-- ─── La caja de Chile ───────────────────────────────────────────────────────────────

insert into destinos (nombre, lat, lng, geo_confianza)
  values ('Bodega en Santiago', -33.45, -70.66, 'manual');

select throws_ok(
  $$ insert into destinos (nombre, lat, lng) values ('En Madrid', 40.4, -3.7) $$,
  '23514', null,
  'una coordenada fuera de Chile rebota: un camión saldría para el lado contrario'
);
select throws_ok(
  $$ insert into destinos (nombre, lat) values ('Media coordenada', -33.45) $$,
  '23514', null,
  'media coordenada no ubica nada y se leería como un dato cargado'
);

-- ─── `attrs` contra la definición VIGENTE (§4.9) ────────────────────────────────────

insert into attribute_definition (entidad, clave, tipo, obligatorio)
  values ('encargos', 'temperatura_objetivo', 'entero', false);

select throws_ok(
  $$ insert into encargos (empresa_cliente_id, destino_id, bultos, attrs)
     select empresa, destino, 5, '{"temperatura_objetivo": "frio"}'::jsonb from e_ids $$,
  '23514', null,
  'un atributo del tipo equivocado rebota: `attrs` no es jsonb libre (§4.9)'
);

select throws_ok(
  $$ insert into encargos (empresa_cliente_id, destino_id, bultos, attrs)
     select empresa, destino, 5, '{"inventado": 1}'::jsonb from e_ids $$,
  '23514', null,
  'una clave que nadie definió rebota, o `attrs` sería el jsonb libre que el §4.9 prohíbe'
);

-- Y el positivo, sin el cual todo lo anterior lo cumpliría un trigger que rechaza siempre.
insert into encargos (empresa_cliente_id, destino_id, bultos, attrs)
  select empresa, destino, 5, '{"temperatura_objetivo": 4}'::jsonb from e_ids;
select is(
  (select count(*)::int from encargos where attrs ? 'temperatura_objetivo'),
  1,
  'un atributo que SÍ cumple su definición entra: el trigger no rechaza todo'
);

select finish();
