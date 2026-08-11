-- pgTAP: la variable norte, con números. [AC-FVEH-20]
--
-- El fixture del AC es literal: **2 vehículos con turno abierto el mismo día ⇒
-- `vehiculos_dia = 2`**, y numerador 0 hasta que el módulo de POD (hitos d/e) emita sus
-- entregas. Se verifica acá y no por HTTP porque la vista no tiene endpoint propio: sus
-- consumidores son el exportador del módulo 00, el panel del 05 y el fixture del 08.
--
-- CREADOR ÚNICO (§2): la vista se define en `0020_eevd_semanal.sql` y en ningún otro lado. Una
-- segunda definición sería una segunda EEVD, y la métrica que gobierna el producto dejaría de
-- tener un solo valor. El último test de este archivo lo verifica contra el catálogo.

select no_plan();

select has_view('eevd_semanal');

-- Las cinco columnas del §2, con esos nombres: los consumidores de otros tres módulos las
-- piden por nombre y un renombre silencioso les rompería el panel sin romper esta suite.
select columns_are(
  'eevd_semanal',
  array['tenant_id', 'semana', 'entregas_con_evidencia', 'vehiculos_dia', 'eevd'],
  'eevd_semanal: las cinco columnas del §2, con sus nombres'
);

-- ─── El fixture del AC, literal ──────────────────────────────────────────────────────
--
-- TODAS las horas van ancladas al MEDIODÍA de Chile del día en curso, y no a `now()`.
--
-- Bug real encontrado el 10-ago-2026 a las 21:17 de Chile: el tercer turno se insertaba con
-- `now() + interval '5 hours'` para simular una segunda jornada del mismo vehículo el mismo día,
-- y a partir de las 19:00 esas cinco horas cruzan la medianoche. El turno caía al día siguiente,
-- los vehículo-día pasaban a ser tres, y el test fallaba — correctamente, porque el fixture ya
-- no decía lo que creía decir.
--
-- O sea: el test fallaba CINCO HORAS DE CADA VEINTICUATRO, justo la franja en que el motor
-- autónomo construye de noche. Anclarlo al mediodía lo vuelve determinista a cualquier hora.
create temporary table cuando as
  select ((now() at time zone 'America/Santiago')::date + time '12:00')
           at time zone 'America/Santiago' as mediodia;

insert into vehiculos (patente, tipo) values ('EEVD001', 'furgón'), ('EEVD002', 'furgón'),
                                             ('EEVD003', 'furgón');

create temporary table e_ids as
  select (select crear_config_version('pgtap eevd')) as config_id,
         (select id from vehiculos where patente = 'EEVD001') as v1,
         (select id from vehiculos where patente = 'EEVD002') as v2,
         (select id from vehiculos where patente = 'EEVD003') as v3;

-- Dos vehículos, el MISMO día.
insert into turnos (vehiculo_id, config_version_id, abierto_en)
  select v1, config_id, mediodia from e_ids, cuando;
insert into turnos (vehiculo_id, config_version_id, abierto_en)
  select v2, config_id, mediodia from e_ids, cuando;

select is(
  (select vehiculos_dia from eevd_semanal
    where semana = date_trunc('week', (now() at time zone 'America/Santiago'))::date),
  2::bigint,
  'dos vehículos con turno abierto el mismo día ⇒ vehiculos_dia = 2 (§2)'
);

select is(
  (select entregas_con_evidencia from eevd_semanal
    where semana = date_trunc('week', (now() at time zone 'America/Santiago'))::date),
  0::bigint,
  'el numerador es 0 hasta que el módulo de POD emita sus entregas (hitos d/e)'
);

-- Un tercer turno del MISMO vehículo en el MISMO día no suma otro vehículo-día: la unidad es
-- el par (vehículo, día), no el turno. Sin esta mitad, un vehículo con tres jornadas cortas
-- inflaría el denominador y la EEVD caería sin que nadie entregara menos.
update turnos set estado = 'cerrado', cerrado_en = abierto_en + interval '4 hours'
 where vehiculo_id = (select v1 from e_ids);
-- Cinco horas después del MEDIODÍA, no de `now()`: a las 17:00 de Chile, que sigue siendo el
-- mismo día a cualquier hora en que corra el gate.
insert into turnos (vehiculo_id, config_version_id, abierto_en)
  select v1, config_id, mediodia + interval '5 hours' from e_ids, cuando;

select is(
  (select vehiculos_dia from eevd_semanal
    where semana = date_trunc('week', (now() at time zone 'America/Santiago'))::date),
  2::bigint,
  'dos turnos del mismo vehículo en el mismo día siguen siendo UN vehículo-día'
);

-- ─── Turno anulado: la interpretación de la spec, condicionada a la pregunta 7 ───────
--
-- CLÁUSULA CONDICIONADA: la spec 02 §1.5 declara que un turno anulado no suma vehículo-día, y
-- es la misma lectura que sostiene el `WHERE estado <> 'anulado'` del EXCLUDE. Sigue siendo la
-- pregunta 7 al dueño; si responde lo contrario, cambian juntos la vista y este test.
insert into turnos (vehiculo_id, config_version_id) select v3, config_id from e_ids;
update turnos set estado = 'anulado' where vehiculo_id = (select v3 from e_ids);

select is(
  (select vehiculos_dia from eevd_semanal
    where semana = date_trunc('week', (now() at time zone 'America/Santiago'))::date),
  2::bigint,
  'un turno anulado no suma vehículo-día (spec 02 §1.5; condicionado a la pregunta 7)'
);

-- ─── Sin operación no hay EEVD, y no hay una EEVD de cero ────────────────────────────

select is(
  (select eevd from eevd_semanal
    where semana = date_trunc('week', (now() at time zone 'America/Santiago'))::date),
  0.00::numeric,
  'con denominador vivo y numerador 0, la EEVD es 0: hubo jornada y no hubo entregas'
);

select is(
  (select count(*)::int from eevd_semanal where vehiculos_dia = 0 and eevd is not null),
  0, 'una semana sin vehículos-día no tiene EEVD de 0: no tiene EEVD (NULL)'
);

-- ─── Creador único ───────────────────────────────────────────────────────────────────

select is(
  (select count(*)::int from pg_views where viewname = 'eevd_semanal'),
  1, 'eevd_semanal está definida UNA sola vez: una segunda sería una segunda EEVD (§2)'
);

select finish();
