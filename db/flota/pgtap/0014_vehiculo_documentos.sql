-- pgTAP: documentos con vencimiento. [AC-FVEH-03]
--
-- Acá va lo que solo la base sostiene: el `sha256` write-once del §4.6 y el borde exacto de
-- «vencido», que es el que decide si un camión sale o se queda. El rebote 422 con feature ON,
-- el no-rebote con feature OFF y el texto de la pantalla viven en
-- `apps/flota/e2e/documentos.spec.ts`.

select no_plan();

select has_table('vehiculo_documentos');
select col_not_null('vehiculo_documentos', c)
  from unnest(array['vehiculo_id', 'tipo', 'vence_el']) as c;

-- El `sha256` es NULLABLE: el §4.6 dice que el hash viaja ANTES del binario, y el alta del
-- vencimiento puede ocurrir sin que nadie haya subido todavía el archivo (§5.4, progresivo).
select col_is_null('vehiculo_documentos', 'sha256');

select matches(
  obj_description('vehiculo_documentos'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'vehiculo_documentos: declara su clase PLANIFICACIÓN (§4.2)'
);

-- ─── El borde de «vencido»: el día del vencimiento TODAVÍA vale ──────────────────────

insert into vehiculos (patente, tipo) values ('DOC0001', 'furgón');

create temporary table d_ids as
  select (select id from vehiculos where patente = 'DOC0001') as v1;

insert into vehiculo_documentos (vehiculo_id, tipo, vence_el)
  select v1, 'revisión técnica', (now() at time zone 'America/Santiago')::date from d_ids;

select is(
  (select tiene_documentos_vencidos((select v1 from d_ids))),
  false,
  'un documento que vence HOY no está vencido: la revisión técnica del 30 sirve el 30 entero'
);

update vehiculo_documentos
   set vence_el = (now() at time zone 'America/Santiago')::date - 1;

select is(
  (select tiene_documentos_vencidos((select v1 from d_ids))),
  true,
  'un documento que venció AYER sí está vencido'
);

-- Y un vehículo sin documentos no tiene ninguno vencido. Sin esta mitad, una función que
-- devolviera siempre `true` pasaría el test de arriba y detendría la flota entera.
insert into vehiculos (patente, tipo) values ('DOC0002', 'furgón');
select is(
  (select tiene_documentos_vencidos((select id from vehiculos where patente = 'DOC0002'))),
  false,
  'un vehículo sin documentos cargados no tiene ninguno vencido'
);

-- ─── `sha256` write-once (§4.6) ──────────────────────────────────────────────────────

update vehiculo_documentos
   set sha256 = repeat('a', 64)
 where vehiculo_id = (select v1 from d_ids);

select is(
  (select sha256 from vehiculo_documentos where vehiculo_id = (select v1 from d_ids)),
  repeat('a', 64),
  'de NULL a un hash sí: el archivo se carga después del vencimiento (§5.4 progresivo)'
);

select throws_ok(
  $$ update vehiculo_documentos set sha256 = repeat('b', 64) $$,
  '23514',
  null,
  'de un hash a otro JAMÁS: reemplazar un documento es una fila nueva (§4.6)'
);

-- Un hash truncado se ve como un hash y no compara nada: el CHECK lo rebota.
select throws_ok(
  $$ insert into vehiculo_documentos (vehiculo_id, tipo, vence_el, sha256)
     select v1, 'permiso', current_date, 'abc123' from d_ids $$,
  '23514',
  null,
  'un sha256 mal formado no entra: uno truncado parece un hash y no sirve para comparar'
);

-- ─── «Por vencer»: el recordatorio del §3.E1.3 [AC-FVEH-17] ──────────────────────────
--
-- La anticipación vive en `parametros` (clave `anticipacion_vencimiento_dias`, cerrada por la
-- P5 de la spec 00). Lo que sigue abierto es su SEED, así que acá se prueba la CONDUCTA con un
-- valor de fixture y no se siembra ninguno.

insert into vehiculos (patente, tipo) values ('DOC0003', 'furgón');

create temporary table d3 as
  select (select id from vehiculos where patente = 'DOC0003') as v;

-- Sin anticipación configurada, «por vencer» NO existe: la columna nace NULL y un default
-- inventado acá sería fabricar la respuesta a la pregunta 1 de la spec 02.
insert into vehiculo_documentos (vehiculo_id, tipo, vence_el)
  select v, 'SOAP', (now() at time zone 'America/Santiago')::date + 3 from d3;

select is(
  (select estado_de_documento(vence_el) from vehiculo_documentos where vehiculo_id = (select v from d3)),
  'vigente',
  'sin anticipación configurada no hay «por vencer»: no se inventa un default (pregunta 1)'
);

insert into parametros (anticipacion_vencimiento_dias) values (10)
  on conflict (unica) do update set anticipacion_vencimiento_dias = 10;

select is(
  (select estado_de_documento(vence_el) from vehiculo_documentos where vehiculo_id = (select v from d3)),
  'por_vencer',
  'con anticipación de 10 días, uno que vence en 3 está «por vencer» (§3.E1.3)'
);

-- El borde de la anticipación: justo en el límite avisa, y un día más allá todavía no. Sin
-- este par, un `<` por un `<=` desplazaría el aviso un día entero sin que nada se ponga rojo.
update vehiculo_documentos set vence_el = (now() at time zone 'America/Santiago')::date + 10
 where vehiculo_id = (select v from d3);
select is(
  (select estado_de_documento(vence_el) from vehiculo_documentos where vehiculo_id = (select v from d3)),
  'por_vencer',
  'el último día de la anticipación todavía avisa'
);

update vehiculo_documentos set vence_el = (now() at time zone 'America/Santiago')::date + 11
 where vehiculo_id = (select v from d3);
select is(
  (select estado_de_documento(vence_el) from vehiculo_documentos where vehiculo_id = (select v from d3)),
  'vigente',
  'un día más allá de la anticipación no avisa: si avisara siempre, nadie miraría el aviso'
);

-- Y «vencido» le gana a «por vencer»: no son dos etiquetas de lo mismo, son dos situaciones
-- distintas y quien mira la lista tiene que ver la peor.
update vehiculo_documentos set vence_el = (now() at time zone 'America/Santiago')::date - 1
 where vehiculo_id = (select v from d3);
select is(
  (select estado_de_documento(vence_el) from vehiculo_documentos where vehiculo_id = (select v from d3)),
  'vencido',
  'un documento vencido dice «vencido», no «por vencer»'
);

select finish();
