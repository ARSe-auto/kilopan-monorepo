-- pgTAP: la proyección del vehículo se mueve SOLO desde `reading`. [AC-FVEH-05]
--
-- Acá va lo que solo la base puede sostener: que el camino a `vehiculos.odometro`/`soc` sea el
-- trigger y ninguno más, que el acotado del SOC ocurra en la proyección y NO en la serie, y que
-- la monotonicidad suave del §4.6 deje la fila declarada intacta. El 2xx con flag, el evento y
-- la fila de «Por revisar» viven en `apps/flota/e2e/lecturas.spec.ts`, que es donde hay HTTP.

select no_plan();

-- Las dos magnitudes de PLATAFORMA, sembradas por la migración: sin ellas un tenant recién
-- provisionado no puede registrar un odómetro hasta que alguien se acuerde de insertar la fila.
select is(
  (select array_agg(codigo order by codigo) from magnitud where codigo in ('odometro', 'soc')),
  array['odometro', 'soc'],
  'magnitud: las dos de plataforma llegaron con la migración (§4.6)'
);

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'reading'::regclass and not tgisinternal and tgname = 'reading_proyecta_vehiculo'),
  1, 'reading: el trigger que proyecta está enganchado'
);

-- ─── El fixture: un vehículo con su turno abierto ────────────────────────────────────

insert into vehiculos (patente, tipo) values ('PROY001', 'furgón'), ('PROY002', 'furgón');

create temporary table p_ids as
  select (select crear_config_version('pgtap proyección')) as config_id,
         (select id from vehiculos where patente = 'PROY001') as v1,
         (select id from vehiculos where patente = 'PROY002') as v2,
         (select id from magnitud where codigo = 'odometro') as m_odo,
         (select id from magnitud where codigo = 'soc') as m_soc;

insert into turnos (vehiculo_id, config_version_id) select v1, config_id from p_ids;

create temporary table p_turno as
  select id as turno from turnos where vehiculo_id = (select v1 from p_ids);

-- ─── SOC: la serie guarda lo declarado, la proyección queda acotada ──────────────────

insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
  select m_soc, 150, 'declarada', (select turno from p_turno), now(), -240 from p_ids;

select is(
  (select soc::int from vehiculos where patente = 'PROY001'),
  100, 'la proyección del SOC queda acotada a 100 aunque llegue 150 (§0 fila SOC)'
);
select is(
  (select valor_int from reading where magnitud_id = (select m_soc from p_ids)),
  150, 'la SERIE guarda lo declarado: 150 entero, sin CHECK de rango que lo rebote'
);

insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
  select m_soc, -20, 'declarada', (select turno from p_turno), now() + interval '1 minute', -240 from p_ids;
select is(
  (select soc::int from vehiculos where patente = 'PROY001'),
  0, 'la proyección del SOC tampoco baja de 0'
);

-- ─── Odómetro: monotonicidad SUAVE ───────────────────────────────────────────────────

insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
  select m_odo, 120000, 'declarada', (select turno from p_turno), now(), -240 from p_ids;
select is(
  (select odometro from vehiculos where patente = 'PROY001'),
  120000, 'el primer odómetro declarado se proyecta tal cual'
);

insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
  select m_odo, 12000, 'declarada', (select turno from p_turno), now() + interval '1 minute', -240 from p_ids;
select is(
  (select odometro from vehiculos where patente = 'PROY001'),
  120000, 'un odómetro menor NO arrastra la proyección hacia atrás: un odómetro no retrocede'
);
select is(
  (select count(*)::int from reading where magnitud_id = (select m_odo from p_ids) and valor_int = 12000),
  1, 'y la fila con el valor menor quedó igual: la captura jamás rebota (§4.2)'
);

insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
  select m_odo, 120500, 'declarada', (select turno from p_turno), now() + interval '2 minutes', -240 from p_ids;
select is(
  (select odometro from vehiculos where patente = 'PROY001'),
  120500, 'un odómetro mayor sí mueve la proyección — si no, la proyección estaría congelada'
);

-- ─── Una lectura sin turno entra y no proyecta nada ──────────────────────────────────

insert into reading (magnitud_id, valor_int, fuente, ts_dispositivo, tz_offset_min)
  select m_odo, 999999, 'declarada', now(), -240 from p_ids;
select is(
  (select odometro from vehiculos where patente = 'PROY001'),
  120500, 'una lectura sin turno no mueve la proyección de nadie'
);
select is(
  (select odometro from vehiculos where patente = 'PROY002'),
  null, 'y menos la del vehículo que no tuvo turno alguno'
);

-- ─── El guardián sigue cerrado para todo el mundo menos el trigger ───────────────────

select throws_ok(
  $$ update vehiculos set odometro = 1 where patente = 'PROY001' $$,
  '23514',
  null,
  'después de la 0019 la proyección SIGUE cerrada al UPDATE directo: el trigger es el único camino'
);

select finish();
