-- pgTAP: la privacidad del rastreo, en la BASE [AC-FTEL-01] — §7.8, §11.
--
-- El AC lo pide con esas palabras: «INSERT con turno cerrado rebota en BD». Un chequeo del
-- servidor («¿el turno está abierto?» antes de insertar) es teatro si la tabla igual acepta la
-- fila cuando alguien —un bug, un endpoint futuro, un replay tardío del outbox de AC-FTEL-03—
-- se salta ese chequeo. Acá se prueba la restricción, no el camino feliz de una ruta HTTP.

select no_plan();

select has_table('posiciones');

select col_not_null('posiciones', c)
  from unnest(array['turno_id', 'lat', 'lng', 'capturada_en']) as c;

select col_is_fk('posiciones', array['tenant_id', 'turno_id']);

select matches(
  obj_description('posiciones'::regclass, 'pg_class'),
  '^CAPTURA',
  'posiciones: declara su clase CAPTURA (§4.2) — la privacidad se resuelve en la base, no rebota'
);

-- ─── La conducta, ejercida contra la base ────────────────────────────────────────────

insert into vehiculos (patente, tipo) values ('POS0001', 'furgón');

create temporary table t_ids as
  select (select crear_config_version('pgtap')) as config_id,
         (select id from vehiculos where patente = 'POS0001') as vehiculo_id;

create temporary table t_turno as
  with ins as (
    insert into turnos (vehiculo_id, config_version_id)
      select vehiculo_id, config_id from t_ids
      returning id
  )
  select id from ins;

-- Con el turno ABIERTO, la posición entra.
select lives_ok(
  $$ insert into posiciones (turno_id, lat, lng)
       select id, -33.45, -70.66 from t_turno $$,
  'con el turno abierto, la posición aterriza'
);

select is(
  (select count(*)::int from posiciones p join t_turno t on t.id = p.turno_id),
  1, 'quedó UNA posición para el turno abierto'
);

-- Se cierra el turno. La privacidad del §7.8 dice que ahí termina el rastreo.
update turnos set estado = 'cerrado', cerrado_en = now() where id = (select id from t_turno);

select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng)
       select id, -33.45, -70.66 from t_turno $$,
  '23514',
  null,
  'con el turno cerrado, el INSERT de una posición rebota (privacidad del rastreo, §7.8)'
);

-- Y no dejó fila: el rebote es de CERO filas nuevas, no una posición fantasma con turno cerrado.
select is(
  (select count(*)::int from posiciones p join t_turno t on t.id = p.turno_id),
  1, 'el rebote del turno cerrado no dejó ninguna fila detrás'
);

-- Un turno que jamás existió rebota igual: no es «el estado es distinto de abierto», es
-- literalmente «no hay abierto» — el `is distinct from` del trigger cubre las dos.
select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng) values (gen_random_uuid(), -33.45, -70.66) $$,
  '23514',
  null,
  'un turno_id que no existe también rebota — no hay abierto que lo autorice'
);

-- Append-only, como todo hecho (§7.4): una posición ya aterrizada no se corrige ni se borra.
select throws_ok(
  $$ update posiciones set lat = 0 where turno_id = (select id from t_turno) $$,
  '42501',
  null,
  'una posición ya aterrizada no se actualiza: es un hecho, no se corrige'
);
select throws_ok(
  $$ delete from posiciones where turno_id = (select id from t_turno) $$,
  '42501',
  null,
  'una posición ya aterrizada no se borra'
);

select finish();
