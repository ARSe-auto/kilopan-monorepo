-- pgTAP: «% de turnos sin incidente de energía», con números exactos. [AC-FVEH-15]
--
-- El AC pide un porcentaje EXACTO contra un fixture de incidentes conocidos, y eso es lo que
-- hay acá. La otra mitad —que un cambio de `parametros` sin deploy no toque el turno abierto—
-- vive en `apps/flota/e2e/documentos.spec.ts`, junto al resto de la config congelada.

select no_plan();

select has_view('energia_sin_incidente_semanal');

select columns_are(
  'energia_sin_incidente_semanal',
  array['tenant_id', 'semana', 'turnos', 'turnos_con_incidente', 'pct_sin_incidente'],
  'la vista de la métrica del §10 tiene sus cinco columnas'
);

-- ─── Fixture: cuatro turnos, uno con incidente ──────────────────────────────────────

insert into vehiculos (patente, tipo) values
  ('TEL0001', 'furgón'), ('TEL0002', 'furgón'), ('TEL0003', 'furgón'), ('TEL0004', 'furgón');

create temporary table t_semana as
  select (select crear_config_version('pgtap telemetría')) as config_id,
         date_trunc('week', (now() at time zone 'America/Santiago'))::date as semana;

insert into turnos (vehiculo_id, config_version_id)
  select v.id, (select config_id from t_semana) from vehiculos v where v.patente like 'TEL%';

-- Un solo turno con incidente: 3 de 4 sin incidente ⇒ 75,0 %.
insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min)
  select tipo.id, 'turnos', t.id, now(), -240
    from evento_tipo tipo,
         (select t.id from turnos t join vehiculos v on v.id = t.vehiculo_id
           where v.patente = 'TEL0001') t
   where tipo.codigo = 'energia.umbral_cruzado';

select is(
  (select turnos from energia_sin_incidente_semanal where semana = (select semana from t_semana)),
  4::bigint,
  'los cuatro turnos de la semana entran al denominador'
);

select is(
  (select pct_sin_incidente from energia_sin_incidente_semanal
    where semana = (select semana from t_semana)),
  75.0::numeric,
  'tres de cuatro turnos sin incidente ⇒ 75,0 % exacto (§10)'
);

-- DOS incidentes MÁS sobre el MISMO turno no cambian nada: se cuenta por turno, no por evento.
-- Sin esta mitad, un solo día malo hundiría el porcentaje de la semana y la métrica diría algo
-- distinto de lo que su nombre promete.
insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min)
  select tipo.id, 'turnos', t.id, now(), -240
    from evento_tipo tipo,
         (select t.id from turnos t join vehiculos v on v.id = t.vehiculo_id
           where v.patente = 'TEL0001') t
   where tipo.codigo in ('energia.retorno_en_riesgo', 'energia.sin_enchufar');

select is(
  (select pct_sin_incidente from energia_sin_incidente_semanal
    where semana = (select semana from t_semana)),
  75.0::numeric,
  'tres incidentes en el mismo turno siguen siendo UN turno con incidente'
);

-- Un turno ANULADO no cuenta, igual que en la EEVD: no se trabajó.
update turnos set estado = 'anulado'
 where vehiculo_id = (select id from vehiculos where patente = 'TEL0004');

select is(
  (select turnos from energia_sin_incidente_semanal where semana = (select semana from t_semana)),
  3::bigint,
  'un turno anulado sale del denominador, igual que en eevd_semanal'
);

-- Y un evento de OTRO tipo sobre el mismo turno no lo marca como incidente de energía: la
-- lista es cerrada, y contar cualquier evento haría que abrir el turno contara como incidente.
insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min)
  select tipo.id, 'turnos', t.id, now(), -240
    from evento_tipo tipo,
         (select t.id from turnos t join vehiculos v on v.id = t.vehiculo_id
           where v.patente = 'TEL0002') t
   where tipo.codigo = 'turno.abierto';

select is(
  (select turnos_con_incidente from energia_sin_incidente_semanal
    where semana = (select semana from t_semana)),
  1::bigint,
  'solo los tres tipos de incidente de energía cuentan: abrir un turno no es un incidente'
);

select finish();
