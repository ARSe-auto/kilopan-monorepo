-- pgTAP: las SEIS invariantes de `posiciones` como CAPTURA del §4.6. [AC-FTEL-02]
--
-- La 0038 prueba la privacidad del §7.8 (sin turno abierto no hay punto). Esta suite prueba lo
-- otro que el AC pide con esas palabras: «nace en `tenant_template` con tenant_id horneado,
-- append-only (UPDATE/DELETE ⇒ 42501 también para el migrador), idempotencia por `client_uuid`
-- (replay doble ⇒ una fila), caja Chile en el CHECK y doble reloj».
--
-- Corre contra el CANARIO, que se provisiona desde `tenant_template` igual que cualquier tenant
-- (`db/flota/pgtap.mjs`): el catálogo que se verifica acá es el que le va a tocar a un cliente, y
-- por eso «nace en la plantilla» se prueba mirando esta base y no una armada a mano.
--
--   1. Nace en la plantilla con el `tenant_id` horneado (DEFAULT + CHECK contra `tenant_actual()`).
--   2. Append-only: UPDATE, DELETE y TRUNCATE ⇒ 42501, también para quien manda en la base.
--   3. Idempotencia por `client_uuid`: el replay doble deja UNA fila.
--   4. Caja de Chile en el CHECK: la isla nula y un punto de otro continente rebotan.
--   5. Doble reloj: el del teléfono (`capturada_en` + `tz_offset_min`) y el del servidor
--      (`recibida_en`), y el teléfono con la hora adulterada NO rebota — es una captura (§4.2).
--   6. `fuente` es un enum CERRADO, y `precision_m` entra sin techo (precisión mala no bloquea).

select no_plan();

-- Fixture: un vehículo, una config y un turno ABIERTO — sin turno abierto ninguna posición
-- aterriza (0074), así que todo lo de abajo cuelga de este turno.
insert into vehiculos (patente, tipo) values ('POS0075', 'furgón');

create temporary table t_turno as
  with ids as (
    select (select crear_config_version('pgtap')) as config_id,
           (select id from vehiculos where patente = 'POS0075') as vehiculo_id
  ), ins as (
    insert into turnos (vehiculo_id, config_version_id)
      select vehiculo_id, config_id from ids
      returning id
  )
  select id from ins;

-- ─── 1. Nace en la plantilla, con el tenant_id HORNEADO ──────────────────────────────
--
-- El §4.1 no se conforma con una columna `tenant_id`: pide que su valor sea la CONSTANTE de esta
-- base. El DEFAULT hace que nadie tenga que acordarse de escribirlo, y el CHECK hace que quien lo
-- escriba distinto rebote — que es lo que convierte «una BD por tenant» en algo que se sostiene
-- solo, sin que ninguna consulta de la app tenga que recordar un WHERE.

select has_table('posiciones');
select has_column('posiciones', 'tenant_id');

select matches(
  (select pg_get_expr(d.adbin, d.adrelid)
     from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'posiciones'::regclass and a.attname = 'tenant_id'),
  'tenant_actual\(\)',
  'posiciones.tenant_id se hornea solo: su DEFAULT es la constante de la base (§4.1)'
);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'posiciones'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tenant_id = tenant_actual()%'),
  1, 'posiciones lleva el CHECK (tenant_id = tenant_actual()) del §4.1'
);

-- Y el CHECK no es decorativo: un tenant_id ajeno escrito a mano rebota.
select throws_ok(
  $$ insert into posiciones (tenant_id, turno_id, lat, lng)
       select '00000000-0000-0000-0000-000000000001'::uuid, id, -33.45, -70.66 from t_turno $$,
  '23514',
  null,
  'un tenant_id que no es el de esta base rebota: la constante manda (§4.1)'
);

-- ─── 2. Append-only, también para quien manda en la base ─────────────────────────────
--
-- El §7.4 se cumple en DOS capas y por eso esta invariante no se agota en el REVOKE: el rol de
-- app pierde UPDATE/DELETE (lo aplica `db/flota/rol-app.mjs` leyendo el catálogo), pero un REVOKE
-- no puede detener al dueño de la tabla —nadie se revoca a sí mismo— ni al superusuario. Lo que
-- los detiene es el trigger. Esta suite corre justamente con esos privilegios, así que el rebote
-- de abajo prueba la capa que el REVOKE no cubre: el migrador, el script de mantenimiento, el
-- psql a mano de madrugada.

select ok(
  (select rolsuper from pg_roles where rolname = current_user)
    or pg_get_userbyid((select relowner from pg_class where oid = 'posiciones'::regclass)) = current_user,
  'esta suite corre como dueño o superusuario: lo que rebote abajo NO puede ser un REVOKE'
);

insert into posiciones (turno_id, lat, lng) select id, -33.45, -70.66 from t_turno;

select throws_ok(
  $$ update posiciones set lat = -20.0 $$,
  '42501',
  null,
  'UPDATE sobre una posición rebota 42501 aunque quien lo intente mande en la base (§7.4)'
);
select throws_ok(
  $$ delete from posiciones $$,
  '42501',
  null,
  'DELETE sobre una posición rebota 42501 aunque quien lo intente mande en la base (§7.4)'
);
select throws_ok(
  $$ truncate posiciones $$,
  '42501',
  null,
  'TRUNCATE tampoco: es el borrado que se disfraza de mantenimiento (§7.4)'
);

-- ─── 3. Idempotencia por `client_uuid`: el replay doble deja UNA fila ────────────────
--
-- Centinela 1 del §9.3.1. El outbox del teléfono reenvía lo que no vio acusado, así que el MISMO
-- punto llega dos veces cada vez que se corta la red en el peor momento. Sin esta unicidad, el
-- mapa del gestor mostraría el mismo punto duplicado y cualquier conteo de posiciones mentiría.

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'posiciones'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(tenant_id, client_uuid)%'),
  1, 'posiciones ofrece UNIQUE (tenant_id, client_uuid) — el arbitro del replay (§4.6)'
);

insert into posiciones (turno_id, lat, lng, client_uuid)
  select id, -33.44, -70.65, '3f9d0a1e-0000-7000-8000-000000000001'::uuid from t_turno
  on conflict (tenant_id, client_uuid) do nothing;
insert into posiciones (turno_id, lat, lng, client_uuid)
  select id, -33.44, -70.65, '3f9d0a1e-0000-7000-8000-000000000001'::uuid from t_turno
  on conflict (tenant_id, client_uuid) do nothing;

select is(
  (select count(*)::int from posiciones
    where client_uuid = '3f9d0a1e-0000-7000-8000-000000000001'::uuid),
  1, 'el replay doble del mismo client_uuid dejó UNA fila (centinela 1, §9.3.1)'
);

-- Y sin el ON CONFLICT rebota, en vez de duplicar en silencio: la idempotencia es de la BD, no
-- una cortesía de quien escribe el INSERT.
select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng, client_uuid)
       select id, -33.44, -70.65, '3f9d0a1e-0000-7000-8000-000000000001'::uuid from t_turno $$,
  '23505',
  null,
  'el mismo client_uuid sin ON CONFLICT rebota: no hay forma de duplicar un punto'
);

-- Dos posiciones SIN client_uuid conviven: la fila que nace en el servidor no tiene ninguno, y
-- dos NULL no chocan en un UNIQUE. Si chocaran, el segundo punto de cualquier turno rebotaría.
select lives_ok(
  $$ insert into posiciones (turno_id, lat, lng) select id, -33.43, -70.64 from t_turno $$,
  'dos posiciones sin client_uuid conviven: NULL no es un valor repetido'
);

-- ─── 4. La caja de Chile, en el CHECK ────────────────────────────────────────────────
--
-- (0,0) es la isla nula: lo que devuelve un GPS sin fix. Aterrizarla pondría el furgón en el
-- golfo de Guinea en el mapa del gestor, y «el mapa degrada, no inventa» (§5.7).

select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng) select id, 0, 0 from t_turno $$,
  '23514',
  null,
  'la isla nula (0,0) rebota: es un GPS sin fix, no un lugar donde estuvo el furgón'
);
select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng) select id, 40.4, -3.7 from t_turno $$,
  '23514',
  null,
  'un punto fuera de la caja de Chile rebota (§4, invariantes EN LA BD)'
);
-- Los extremos SÍ entran: Arica por el norte y el territorio austral por el sur. Un CHECK que
-- dejara el país afuera sería peor que no tenerlo — rebotaría capturas reales.
select lives_ok(
  $$ insert into posiciones (turno_id, lat, lng) select id, -18.48, -70.31 from t_turno $$,
  'Arica está adentro de la caja: el CHECK acota el error, no el país'
);
select lives_ok(
  $$ insert into posiciones (turno_id, lat, lng) select id, -53.16, -70.91 from t_turno $$,
  'Punta Arenas está adentro de la caja'
);

-- ─── 5. Doble reloj: el del teléfono y el del servidor ───────────────────────────────
--
-- El §4 lo reparte así: el del servidor manda para negocio, el del teléfono fecha el día y se
-- guarda para diagnóstico. Guardar uno solo obliga a elegir entre confiar en un reloj que el
-- chofer puede mover y perder la hora que el chofer vio en su pantalla.

select has_column('posiciones', 'capturada_en');
select has_column('posiciones', 'tz_offset_min');
select has_column('posiciones', 'recibida_en');
select col_not_null('posiciones', 'recibida_en');

insert into posiciones (turno_id, lat, lng, capturada_en, tz_offset_min, client_uuid)
  select id, -33.42, -70.63, now() - interval '5 minutes', -240,
         '3f9d0a1e-0000-7000-8000-000000000002'::uuid
    from t_turno;

select is(
  (select tz_offset_min from posiciones
    where client_uuid = '3f9d0a1e-0000-7000-8000-000000000002'::uuid),
  -240, 'el huso del teléfono se guarda tal como vino (Chile continental: −240)'
);
select ok(
  (select recibida_en > capturada_en from posiciones
    where client_uuid = '3f9d0a1e-0000-7000-8000-000000000002'::uuid),
  'los dos relojes quedan por separado: el servidor fechó su llegada, el teléfono su captura'
);

-- Un teléfono con la hora adulterada NO rebota: es una CAPTURA (§4.2), y el reloj que manda para
-- negocio —`recibida_en`— lo pone el servidor y no se puede mover desde el aparato.
select lives_ok(
  $$ insert into posiciones (turno_id, lat, lng, capturada_en, tz_offset_min)
       select id, -33.41, -70.62, now() + interval '3 days', -180 from t_turno $$,
  'el reloj adelantado del teléfono no rebota la captura (§4.2) — queda el del servidor'
);
select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng, tz_offset_min)
       select id, -33.41, -70.62, 4000 from t_turno $$,
  '23514',
  null,
  'un huso que no existe en la Tierra rebota: eso no es un aparato en otro país, es basura'
);

-- ─── 6. `fuente` cerrada y `precision_m` sin techo ───────────────────────────────────

select has_type('posicion_fuente');
select enum_has_labels('posicion_fuente', array['telefono_gps']);
select is(
  (select fuente::text from posiciones
    where client_uuid = '3f9d0a1e-0000-7000-8000-000000000002'::uuid),
  'telefono_gps', 'la fuente por defecto es el teléfono del chofer (§11)'
);
select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng, fuente)
       select id, -33.45, -70.66, 'satelite_inventado' from t_turno $$,
  '22P02',
  null,
  'una fuente fuera del enum no entra: el catálogo de fuentes se amplía con un ALTER TYPE'
);

-- Precisión mala JAMÁS bloquea (§4: «el pan no espera»): 900 metros de error entran igual, y es
-- la torre de control (AC-FTEL-04) la que decide qué hacer con un punto así.
select lives_ok(
  $$ insert into posiciones (turno_id, lat, lng, precision_m)
       select id, -33.40, -70.61, 900 from t_turno $$,
  'una posición con 900 m de precisión entra: precisión mala no bloquea (§4)'
);
select throws_ok(
  $$ insert into posiciones (turno_id, lat, lng, precision_m)
       select id, -33.40, -70.61, -1 from t_turno $$,
  '23514',
  null,
  'una precisión negativa rebota: no es precisión mala, es un dato roto'
);

select finish();
