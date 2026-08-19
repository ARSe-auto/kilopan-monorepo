-- pgTAP: el vehículo-día y su EXCLUDE de solape. [AC-FVEH-06]
--
-- El rebote por HTTP —422 con 0 filas y su mensaje— vive en `apps/flota/e2e/vehiculos.spec.ts`.
-- Acá va lo que solo la BASE puede sostener: que el solape lo decida una restricción y no un
-- `select` del servidor, y que el `WHERE estado <> 'anulado'` del §4.5 esté aplicado de verdad.
-- La diferencia importa: un chequeo en el servidor pasa en verde contra un test secuencial y
-- se rompe con dos aperturas simultáneas, que es justo cuando duele.

select no_plan();

select has_table('turnos');

select col_not_null('turnos', c)
  from unnest(array['vehiculo_id', 'config_version_id', 'estado', 'abierto_en', 'periodo']) as c;

-- `config_version_id` NOT NULL es la mitad literal del §4.4: un turno corre entero con UNA
-- versión, y uno sin versión es un turno cuyas reglas nadie puede reconstruir mañana.
select col_is_fk('turnos', array['tenant_id', 'config_version_id']);
select col_is_fk('turnos', array['tenant_id', 'vehiculo_id']);

-- El cierre y el «¿quedó enchufado?» nacen NULOS: no es lo mismo «no lo dejó enchufado» que
-- «todavía no se preguntó», y el rojo del Anexo B se apoya en esa diferencia.
select col_is_null('turnos', c)
  from unnest(array['cerrado_en', 'semaforo_salida', 'enchufado_confirmado']) as c;

select matches(
  obj_description('turnos'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'turnos: declara su clase PLANIFICACIÓN (§4.2) — la apertura online rebota'
);

-- La restricción EXISTE y es de exclusión, no un índice único disfrazado: un UNIQUE no sabe
-- de solape de rangos y dejaría entrar dos jornadas que se pisan por media hora.
select is(
  (select contype::text from pg_constraint where conname = 'turnos_sin_solape'),
  'x', 'turnos: el solape lo impide una restricción EXCLUDE, no el servidor'
);

-- Y su `WHERE` es el del §4.5, literal.
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'turnos_sin_solape'),
  'WHERE \(\(estado <> ''anulado''::turno_estado\)\)',
  'turnos: el EXCLUDE excluye los anulados, como pide el §4.5'
);

-- ─── La conducta, ejercida contra la base ────────────────────────────────────────────

insert into vehiculos (patente, tipo) values ('TURNO01', 'furgón'), ('TURNO02', 'furgón');

create temporary table t_ids as
  select (select crear_config_version('pgtap')) as config_id,
         (select id from vehiculos where patente = 'TURNO01') as v1,
         (select id from vehiculos where patente = 'TURNO02') as v2;

insert into turnos (vehiculo_id, config_version_id) select v1, config_id from t_ids;

-- El segundo turno del MISMO vehículo, con el primero abierto, rebota: el rango de un turno
-- sin cerrar llega al infinito y ocupa el día entero del camión.
select throws_ok(
  $$ insert into turnos (vehiculo_id, config_version_id) select v1, config_id from t_ids $$,
  '23P01',
  null,
  'un segundo turno del mismo vehículo con el primero abierto rebota (centinela 5 §9.3)'
);

-- Y no dejó fila: el rebote es de CERO filas, que es lo que el AC pide con esas palabras.
select is(
  (select count(*)::int from turnos where vehiculo_id = (select v1 from t_ids)),
  1, 'el rebote del solape no dejó ninguna fila detrás'
);

-- OTRO vehículo, el mismo instante: no hay solape que valga. Sin esta mitad, la restricción
-- podría estar prohibiendo cualquier segundo turno y el test de arriba pasaría igual.
insert into turnos (vehiculo_id, config_version_id) select v2, config_id from t_ids;
select is(
  (select count(*)::int from turnos),
  2, 'dos vehículos distintos abren su jornada a la misma hora sin estorbarse'
);

-- Un turno ANULADO libera el día. Es la razón del `WHERE`: si lo ocupara, un error de apertura
-- dejaría al camión sin poder trabajar esa jornada, y la única salida sería borrar un hecho —
-- que el §7.4 prohíbe.
update turnos set estado = 'anulado' where vehiculo_id = (select v1 from t_ids);
insert into turnos (vehiculo_id, config_version_id) select v1, config_id from t_ids;
select is(
  (select count(*)::int from turnos where vehiculo_id = (select v1 from t_ids) and estado = 'abierto'),
  1, 'un turno anulado no ocupa el día del vehículo: el siguiente entra'
);

-- Un turno CERRADO sí liberó su ventana hacia adelante, y no hacia atrás: el rango deja de ser
-- infinito recién cuando hay `cerrado_en`.
select throws_ok(
  $$ update turnos set estado = 'cerrado', cerrado_en = abierto_en
      where vehiculo_id = (select v1 from t_ids) and estado = 'abierto' $$,
  '23514',
  null,
  'un turno no puede cerrar en el mismo instante en que abrió'
);

select finish();
