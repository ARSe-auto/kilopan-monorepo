-- 0032 — «% de turnos sin incidente de energía», computable desde hechos. [AC-FVEH-15]
--
-- El §10 pide la métrica «% de rutas sin incidente de energía». Las RUTAS son del hito (d), así
-- que el corte que se puede computar hoy es por TURNO — y el AC lo acota con esas palabras: «el
-- corte por RUTA se completa cuando el hito d entregue rutas». Cambiar el denominador después
-- será una línea en esta vista, no un rediseño, porque el numerador ya sale de eventos.
--
-- ─── QUÉ ES UN INCIDENTE DE ENERGÍA ────────────────────────────────────────────────
--
-- Los tres que el maestro nombra: cruzar un umbral de alerta (§0: la familia 30/20/15/10),
-- el retorno proyectado por debajo del mínimo, y «no quedó enchufado» a la hora límite (Anexo
-- B). Los tres quedan como EVENTOS append-only, no como un contador: el §2 lo exige para la
-- EEVD y vale igual acá — un contador mutable es un número que alguien puede corregir a mano, y
-- el día que la métrica empeore va a haber una razón muy buena para corregirlo.
--
-- Quién EMITE estos eventos es el módulo del semáforo (hito e, §5.6): el motor de evaluación
-- con histéresis vive ahí. Este módulo deja el catálogo y la consulta, que es lo que el AC
-- pide — «queda computable desde este módulo».

insert into evento_tipo (codigo, descripcion) values
  ('energia.umbral_cruzado',    'La carga del vehículo cruzó un umbral de alerta durante el turno'),
  ('energia.retorno_en_riesgo', 'El retorno proyectado quedó por debajo del mínimo durante el turno'),
  ('energia.sin_enchufar',      'El vehículo no quedó enchufado a la hora límite tras cerrar el turno');

/**
 * Los turnos de una semana y cuántos tuvieron incidente de energía.
 *
 * Se cuenta por TURNO y no por evento: un turno con tres umbrales cruzados es UN turno con
 * incidente, no tres. Contar eventos haría que un solo día malo hundiera el porcentaje de la
 * semana y que la métrica dijera algo distinto de lo que su nombre promete.
 *
 * Los turnos anulados no cuentan, igual que en `eevd_semanal`: no se trabajaron.
 */
create or replace view energia_sin_incidente_semanal as
  with turnos_de_la_semana as (
    select t.id,
           date_trunc('week', (t.abierto_en at time zone 'America/Santiago'))::date as semana
      from turnos t
     where t.estado <> 'anulado'
  ),
  con_incidente as (
    select distinct t.id, t.semana
      from turnos_de_la_semana t
      join eventos e on e.objeto_tabla = 'turnos' and e.objeto_id = t.id
      join evento_tipo tipo on tipo.id = e.tipo_id
     where tipo.codigo in ('energia.umbral_cruzado', 'energia.retorno_en_riesgo', 'energia.sin_enchufar')
  )
  select tenant_actual()                                        as tenant_id,
         t.semana,
         count(*)::bigint                                       as turnos,
         count(*) filter (where i.id is not null)::bigint        as turnos_con_incidente,
         -- NULL y no cero cuando no hubo turnos: una semana sin operación no tiene un 100% de
         -- turnos sin incidente, no tiene porcentaje. Un 100 ahí subiría el promedio del mes
         -- por una semana en que la flota no salió.
         round(
           100.0 * count(*) filter (where i.id is null)::numeric / nullif(count(*), 0)::numeric,
           1
         )                                                      as pct_sin_incidente
    from turnos_de_la_semana t
    left join con_incidente i on i.id = t.id
   group by t.semana;

comment on view energia_sin_incidente_semanal is
  'La métrica del §10 con el corte que se puede computar hoy: por TURNO. El corte por RUTA se '
  'completa cuando el hito (d) entregue rutas. Se cuenta por turno y no por evento: un turno '
  'con tres umbrales cruzados es UN turno con incidente, no tres.';
