-- pgTAP: los DATOS FUENTE de las señales Flota/EV están, y son evaluables. [AC-FVEH-11]
--
-- El AC pide que «con fixture de turnos/reading/energy_entry/eventos de este módulo, un test CI
-- compute los predicados del Anexo B y obtenga los estados esperados». Los PREDICADOS, puros,
-- viven en `packages/nucleo-comun/src/senales-ev.ts` con sus mutantes. Acá se verifica la otra
-- mitad, la que sin base no se puede probar: que las cuatro fuentes existan, tengan los datos
-- que los predicados piden y se puedan leer juntas.
--
-- El motor de evaluación con histéresis, el DDL de `signal_rule` y la tarjeta son del hito (e).

select no_plan();

-- Las cuatro fuentes que el AC nombra por su nombre.
select has_table(t) from unnest(array['turnos', 'reading', 'energy_entry', 'eventos']) as t;

-- `turnos.enchufado_confirmado` es la única señal del dominio que NO depende de la pregunta 13:
-- sale directo, sin estimación de por medio. Y es NULLABLE, que es lo que permite distinguir
-- «no quedó enchufado» de «nadie preguntó todavía» — tratar el nulo como falso pondría en rojo
-- a cada vehículo que sigue trabajando.
select col_is_null('turnos', 'enchufado_confirmado');

-- Los datos EV que los predicados necesitan del vehículo (§4.5).
select has_column('vehiculos', c)
  from unnest(array['bateria_wh', 'autonomia_nominal_km', 'wh_por_km_base', 'soh_pct', 'soc']) as c;

-- ─── Fixture: un turno con su lectura, su recarga y su evento ───────────────────────

insert into vehiculos (patente, tipo, bateria_wh, autonomia_nominal_km, wh_por_km_base, soh_pct)
  values ('SEN0001', 'furgón', 41860, 300, 200, 95);

create temporary table s_ids as
  select (select crear_config_version('pgtap señales')) as config_id,
         (select id from vehiculos where patente = 'SEN0001') as v,
         (select id from magnitud where codigo = 'soc') as m_soc;

insert into turnos (vehiculo_id, config_version_id) select v, config_id from s_ids;

insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
  select m_soc, 42, 'declarada',
         (select id from turnos where vehiculo_id = (select v from s_ids)), now(), -240
    from s_ids;

insert into energy_entry (vehiculo_id, type, wh, soc_inicial, soc_final, ts_dispositivo, tz_offset_min)
  select v, 'charge', 25000, 42, 90, now(), -240 from s_ids;

-- La consulta que el motor del hito (e) va a hacer: el estado EV de un vehículo, de una sola
-- lectura. Si esto no se pudiera armar, «datos fuente evaluables» sería una frase.
select is(
  (select count(*)::int
     from turnos t
     join vehiculos v on v.id = t.vehiculo_id
     left join lateral (
       select r.valor_int from reading r
         join magnitud m on m.id = r.magnitud_id
        where r.turno_id = t.id and m.codigo = 'soc'
        order by r.ts_dispositivo desc limit 1
     ) ultimo_soc on true
    where v.patente = 'SEN0001'
      and v.autonomia_nominal_km is not null
      and v.wh_por_km_base is not null
      and ultimo_soc.valor_int is not null),
  1,
  'el estado EV de un vehículo se arma de una lectura: turno + ficha + último SOC (Anexo B)'
);

-- La proyección se movió sola desde la lectura, que es de dónde el motor va a leer el SOC
-- actual sin recorrer la serie entera.
select is(
  (select soc::int from vehiculos where patente = 'SEN0001'),
  42,
  'la proyección del vehículo tiene el SOC actual, sin recorrer la serie'
);

-- Y la energía de la sesión de recarga quedó en Wh enteros, que es lo que el Anexo A consume.
select is(
  (select wh from energy_entry where vehiculo_id = (select v from s_ids)),
  25000,
  'la sesión de recarga deja su energía en Wh enteros (§0, Anexo A)'
);

-- Los tres tipos de evento de incidente del dominio están en el catálogo, listos para que el
-- motor del hito (e) los emita. Sin ellos, ese motor tendría que crear filas de catálogo al
-- vuelo — que es exactamente lo que `registrarEvento` prohíbe.
select is(
  (select count(*)::int from evento_tipo where codigo like 'energia.%'),
  4,
  'el catálogo tiene los eventos de energía que el motor del hito (e) va a emitir'
);

select finish();
