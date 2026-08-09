-- pgTAP: UUIDv7 server-side como PK e idempotencia por client_uuid (§0). [AC-FTEN-08]
--
-- El AC pide las DOS mitades y por separado, porque cada una sola miente:
--   (a) el CATÁLOGO — que la PK sea uuid y su DEFAULT sea la función de UUIDv7 del servidor.
--       Sola no prueba que funcione.
--   (b) el COMPORTAMIENTO — insertar sin PK y ver que el servidor la puso, con el nibble de
--       versión en 7. Sola no prueba que sea así en TODAS las tablas, solo en la que se probó.
--
-- Y una tercera cosa que ninguna de las dos da: que el catálogo ejercitado NO esté vacío. Un
-- verde vacuo acá sería el peor de todos, porque este es justamente el test que se escribe
-- antes de que existan las tablas que tiene que revisar.

select no_plan();

-- QUÉ ES UNA TABLA DE DOMINIO: la que lleva `tenant_id`. Nada más. Empezó siendo una lista
-- negra de nombres (`schema_migrations`, `tenant_info`) y esa lista se quedó vieja con la
-- primera tabla de mecanismo que llegó después —`config_versionada`, de AC-FTEN-13—, que puso
-- esta suite en rojo por tener un PK de texto. El criterio es el mismo que usa el linter de
-- migraciones y no hay que mantenerlo en dos lados: si tiene `tenant_id`, es de dominio.
-- `tenant_info` no lo lleva (define al tenant, no le pertenece) y se verifica aparte más abajo.
create temporary table pk_de_dominio on commit drop as
select c.relname                                  as tabla,
       a.attname                                  as columna,
       format_type(a.atttypid, null)              as tipo,
       pg_get_expr(d.adbin, d.adrelid)            as por_omision,
       array_length(i.indkey::int2[], 1)          as columnas_de_la_pk
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_index i on i.indrelid = c.oid and i.indisprimary
  join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where n.nspname = 'public'
   and c.relkind = 'r'
   and exists (
     select 1 from pg_attribute ta
      where ta.attrelid = c.oid and ta.attname = 'tenant_id' and ta.attnum > 0
        and not ta.attisdropped);

select cmp_ok(
  (select count(*)::int from pk_de_dominio), '>', 0,
  'el catálogo de PKs de dominio NO está vacío (verde vacuo prohibido)'
);

select is_empty(
  $$ select tabla || ' → ' || tipo from pk_de_dominio where tipo <> 'uuid' $$,
  'toda PK de tabla de dominio es uuid: jamás bigint, jamás serial (§0)'
);

select is_empty(
  $$ select tabla from pk_de_dominio where columnas_de_la_pk <> 1 $$,
  'la PK es de una sola columna: la separación por tenant es física, no una PK compuesta'
);

select is_empty(
  $$ select tabla || ' → ' || coalesce(por_omision, '(sin DEFAULT)')
       from pk_de_dominio where por_omision is distinct from 'uuidv7()' $$,
  'toda PK de dominio se puebla con uuidv7() del SERVIDOR, no del cliente (§0)'
);

-- La función es la NATIVA de PostgreSQL 18, no una implementación propia que alguien pudiera
-- cambiar sin que nadie se entere.
select is(
  (select p.pronamespace::regnamespace::text from pg_proc p
    where p.proname = 'uuidv7' and p.pronargs = 0),
  'pg_catalog',
  'uuidv7() es la del catálogo del servidor (PostgreSQL >= 18)'
);

-- (b) El comportamiento: insertar sin PK y ver qué puso el servidor.
select lives_ok(
  $$ insert into review_queue (origen, severidad) values ('pgtap_uuidv7', 'baja') $$,
  'INSERT sin PK: el servidor la genera y no rebota'
);

select is(
  (select substring(id::text from 15 for 1) from review_queue where origen = 'pgtap_uuidv7'),
  '7',
  'la PK que generó el servidor tiene los bits de versión 7'
);

select isnt(
  (select id::text from review_queue where origen = 'pgtap_uuidv7'),
  null,
  'la PK generada no es nula'
);

-- `tenant_info` está exenta del catálogo de arriba porque su fila la siembra la provisión,
-- no un DEFAULT — pero su id igual sale de `uuidv7()` EN EL SERVIDOR (AC-FTEN-02).
select is(
  (select substring(id::text from 15 for 1) from tenant_info),
  '7',
  'tenant_info.id también es UUIDv7 aunque su fila la siembre la provisión'
);

-- IDEMPOTENCIA (§0 contrato de client_uuid). Toda tabla que reciba mutaciones offline lo
-- lleva, y con UNIQUE (tenant_id, client_uuid): sin el tenant_id adelante, el índice no
-- serviría el día que dos bases se consoliden (§4.1).
create temporary table con_client_uuid on commit drop as
select c.oid, c.relname as tabla, format_type(a.atttypid, null) as tipo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'client_uuid' and a.attnum > 0
 where n.nspname = 'public' and c.relkind = 'r';

select cmp_ok(
  (select count(*)::int from con_client_uuid), '>', 0,
  'hay al menos una tabla con client_uuid (verde vacuo prohibido)'
);

select is_empty(
  $$ select tabla || ' → ' || tipo from con_client_uuid where tipo <> 'uuid' $$,
  'client_uuid es uuid en todas partes'
);

select is_empty(
  $$
  select t.tabla from con_client_uuid t
   where not exists (
     select 1 from pg_index i
      where i.indrelid = t.oid and i.indisunique and i.indnkeyatts = 2
        and (select array_agg(att.attname::text order by k.ord)
               from unnest(i.indkey) with ordinality k(attnum, ord)
               join pg_attribute att on att.attrelid = t.oid and att.attnum = k.attnum)
            = array['tenant_id', 'client_uuid'])
  $$,
  'toda tabla con client_uuid lleva UNIQUE (tenant_id, client_uuid) (§4.1)'
);

-- CASO DE DEGRADACIÓN del AC: el mismo client_uuid dos veces con ON CONFLICT DO NOTHING deja
-- exactamente una fila y NINGÚN error. Es el contrato del replay del outbox: un reintento no
-- es un error, y una captura reintentada no puede convertirse en dos.
select lives_ok(
  $$ insert into client_metric (tipo, valor_int, ts, tz_offset_min, client_uuid)
     values ('sync_error', 1, now(), -240, '019fe000-0000-7000-8000-00000000ab01')
     on conflict (tenant_id, client_uuid) do nothing $$,
  'primer INSERT de la captura: entra'
);

select lives_ok(
  $$ insert into client_metric (tipo, valor_int, ts, tz_offset_min, client_uuid)
     values ('sync_error', 1, now(), -240, '019fe000-0000-7000-8000-00000000ab01')
     on conflict (tenant_id, client_uuid) do nothing $$,
  'replay de la MISMA captura: no rebota (un reintento no es un error)'
);

select is(
  (select count(*)::int from client_metric
    where client_uuid = '019fe000-0000-7000-8000-00000000ab01'),
  1,
  'el doble INSERT dejó exactamente 1 fila'
);

-- Y sin ON CONFLICT sí rebota: el índice está vivo, no es decorativo.
select throws_ok(
  $$ insert into client_metric (tipo, valor_int, ts, tz_offset_min, client_uuid)
     values ('sync_error', 2, now(), -240, '019fe000-0000-7000-8000-00000000ab01') $$,
  '23505',
  null,
  'sin ON CONFLICT el UNIQUE rebota: el índice está vivo'
);

select * from finish();
