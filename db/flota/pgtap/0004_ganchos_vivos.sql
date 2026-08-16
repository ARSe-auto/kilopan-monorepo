-- pgTAP: ganchos de extensión VIVOS de E1 (§4.6, §4.9). [AC-FTEN-14]
--
-- Lo que se verifica acá es el MECANISMO del §4.9: que un vertical nuevo sea un INSERT de
-- filas y no una migración, y que `attrs` no sea jsonb libre. Más la ausencia deliberada del
-- CHECK de rango sobre `reading.valor_int`, que es una decisión y no un olvido — y una
-- ausencia solo se puede probar mirando el catálogo.

select no_plan();

-- --- Las tablas existen, con su clase de la regla de oro ----------------------------------
select has_table('cargo_type');
select has_table('magnitud');
select has_table('attribute_definition');
select has_table('reading');
select has_table('instrument');
select has_table('vehicle_certification');
select has_table('stop_requirement');
select has_table('lot');
select has_table('reference_document');

-- `lot` y `reference_document` son CAPTURA por respuesta del dueño del 08-ago-2026: un lote se
-- lee de la caja en terreno y un DTE se asocia en la parada de carga, los dos posiblemente sin
-- señal. Con PLANIFICACIÓN rebotarían 422 y se perderían (§4.2).
select matches(obj_description('lot'::regclass, 'pg_class'), '^CAPTURA —',
  'lot es CAPTURA (respuesta del dueño, Pregunta 11)');
select matches(obj_description('reference_document'::regclass, 'pg_class'), '^CAPTURA —',
  'reference_document es CAPTURA (respuesta del dueño, Pregunta 13)');
select matches(obj_description('reading'::regclass, 'pg_class'), '^CAPTURA —',
  'reading es CAPTURA: la lectura entra siempre');

-- --- reading: UNA tabla, doble idempotencia, y SIN rango -----------------------------------
select col_type_is('reading', 'valor_int', 'integer', 'la lectura es un entero (§0 unidades)');

-- LA AUSENCIA (§0 fila SOC, §9.3.4). El CHECK 0–100 vive SOLO en la proyección `vehiculos.soc`
-- (hito c). Acá un rango haría que una sonda descalibrada REBOTARA la captura del chofer, que
-- es exactamente lo que el §4.2 prohíbe.
select is_empty(
  $$ select c.conname from pg_constraint c
      where c.conrelid = 'reading'::regclass and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%valor_int%' $$,
  'reading.valor_int NO tiene CHECK de rango: la captura fuera de rango entra con flag (§0)'
);

-- Idempotencia DOBLE del §4.6: el client_uuid cubre el replay del outbox; la tripleta cubre el
-- archivo de un logger importado dos veces, donde no hay client_uuid ninguno.
select col_is_unique('reading', array['tenant_id', 'client_uuid'],
  'reading es idempotente por client_uuid');
select col_is_unique('reading', array['tenant_id', 'instrumento_id', 'sensor', 'ts_dispositivo'],
  'reading es idempotente además por (instrumento, sensor, ts): el logger no tiene client_uuid');

select bag_eq(
  $$ select unnest(enum_range(null::lectura_fuente))::text $$,
  $$ values ('declarada'), ('archivo_logger'), ('api_fabricante'),
            ('sonda_vehiculo'), ('obd'), ('ocpp') $$,
  'el enum de fuente de lectura es el CERRADO del §4.6'
);

-- --- reference_document: la app JAMÁS emite DTE (§7.3, art. 97 N°4 CT) ---------------------
select bag_eq(
  $$ select unnest(enum_range(null::dte_tipo))::text $$,
  $$ values ('33'), ('39'), ('52'), ('61') $$,
  'los tipos de DTE referenciables son los cuatro del §4.6, y ninguno más'
);
select col_is_unique('reference_document', array['tipo', 'folio', 'emisor'],
  'UNIQUE(tipo, folio, emisor): el mismo documento no se referencia dos veces');
-- Y ninguna columna que huela a EMITIR: ni xml, ni ted, ni track_id, ni estado_sii.
select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'reference_document'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname ~ 'xml|ted|track|timbre|caf|estado_sii' $$,
  'reference_document no tiene columnas de EMISIÓN: la app solo referencia (§7.3)'
);

-- --- El mecanismo del §4.9: un vertical nuevo son INSERTs ----------------------------------
-- Tabla FIXTURE con `attrs`: ninguna tabla de este módulo la lleva todavía (las de los hitos
-- c y d sí), así que el mecanismo se ejerce sobre una del harness — igual que el patrón de RLS
-- de dinero de AC-FTEN-21. Todo esto vive dentro de la transacción que el arnés revierte.
create table fixture_encargos (
  id        uuid  not null primary key default uuidv7(),
  tenant_id uuid  not null default tenant_actual() check (tenant_id = tenant_actual()),
  attrs     jsonb not null default '{}'::jsonb,
  unique (tenant_id, id)
);
create trigger fixture_encargos_attrs
  before insert or update on fixture_encargos
  for each row execute function validar_attrs('fixture_encargos');

-- El vertical sintético se activa con INSERTs y CERO migraciones nuevas. Esa es la métrica 4
-- del §2 y la promesa entera del §4.9.
-- `vigente_desde` en el pasado a propósito: dentro de UNA transacción `now()` está congelado,
-- así que sin esto no habría forma de superseder una definición más abajo y esa mitad del
-- mecanismo quedaría sin probar.
select lives_ok(
  $$ insert into attribute_definition (entidad, clave, tipo, obligatorio, opciones, vigente_desde) values
       ('fixture_encargos', 'temperatura_objetivo', 'entero', false, null, now() - interval '1 hour'),
       ('fixture_encargos', 'cadena_frio', 'opcion', true, array['si', 'no'], now() - interval '1 hour') $$,
  'un vertical nuevo se define con INSERTs: cero migraciones (§4.9, §2 métrica 4)'
);

-- Y un tipo `opcion` sin su conjunto de opciones no entra: una opción sin opciones es texto
-- libre con otro nombre.
select throws_ok(
  $$ insert into attribute_definition (entidad, clave, tipo) values ('fixture_encargos', 'x', 'opcion') $$,
  '23514', null,
  'un atributo de tipo opción sin conjunto de opciones rebota'
);

select lives_ok(
  $$ insert into fixture_encargos (attrs) values ('{"cadena_frio": "si", "temperatura_objetivo": 4}') $$,
  'attrs conforme a la definición vigente entra'
);

select throws_ok(
  $$ insert into fixture_encargos (attrs) values ('{"cadena_frio": "si", "inventado": 1}') $$,
  '23514', null,
  'una clave NO definida rebota: attrs no es jsonb libre (§4.9)'
);

select throws_ok(
  $$ insert into fixture_encargos (attrs) values ('{"cadena_frio": "si", "temperatura_objetivo": "cuatro"}') $$,
  '23514', null,
  'un valor del tipo equivocado rebota'
);

select throws_ok(
  $$ insert into fixture_encargos (attrs) values ('{"cadena_frio": "quizas"}') $$,
  '23514', null,
  'una opción fuera del conjunto declarado rebota'
);

select throws_ok(
  $$ insert into fixture_encargos (attrs) values ('{"temperatura_objetivo": 4}') $$,
  '23514', null,
  'falta un atributo OBLIGATORIO vigente ⇒ rebota (sin esta mitad, exigir algo no serviría)'
);

-- VERSIONADA: una definición no se edita, se supersede. Los `attrs` ya escritos no pueden
-- volverse inválidos retroactivamente contra una definición que nadie aceptó cuando se
-- escribieron (§4.2).
select lives_ok(
  $$ update attribute_definition set vigente_hasta = now()
      where entidad = 'fixture_encargos' and clave = 'cadena_frio';
     insert into attribute_definition (entidad, clave, version, tipo, obligatorio, opciones)
       values ('fixture_encargos', 'cadena_frio', 2, 'opcion', true, array['si', 'no', 'parcial']) $$,
  'la definición se supersede con una versión nueva, no se edita'
);

select lives_ok(
  $$ insert into fixture_encargos (attrs) values ('{"cadena_frio": "parcial"}') $$,
  'la versión NUEVA es la que valida: la opción agregada ahora entra'
);

select * from finish();
