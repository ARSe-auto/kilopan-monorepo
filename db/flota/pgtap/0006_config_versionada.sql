-- pgTAP: configuración versionada y congelada (§4.4). [AC-FTEN-13]
--
-- El caso de degradación del AC es el que importa: editar la configuración con una versión ya
-- referenciada JAMÁS altera esa versión. Si se pudiera, «congelada» sería una forma de hablar
-- y el turno de la semana pasada cambiaría de reglas retroactivamente.

select no_plan();

select has_table('config_version');
select has_table('config_versionada');
select has_function('crear_config_version', array['text', 'jsonb']);

-- El snapshot es GLOBAL (respuesta del dueño a la Pregunta 4): una versión trae TODAS las
-- tablas de configuración registradas, no un puntero por tabla.
select cmp_ok((select count(*)::int from config_versionada), '>', 0,
  'hay tablas de configuración registradas (verde vacuo prohibido)');

insert into parametros (tarifa_kwh_clp, precio_diesel_litro_clp) values (190, 1260);
insert into vertical_template (vertical, meta_eevd) values ('panaderia', 18);
insert into grupos (nombre) values ('norte');

select lives_ok(
  $$ select crear_config_version('alta del tenant', '{"tarifas": true}'::jsonb) $$,
  'la primera versión se sella'
);

select is_empty(
  $$ select cv.tabla from config_versionada cv
      where not (select snapshot from config_version order by id desc limit 1) ? cv.tabla $$,
  'el snapshot trae TODAS las tablas registradas: es global, no por tabla'
);

select is(
  (select snapshot #>> '{parametros,0,tarifa_kwh_clp}' from config_version limit 1),
  '190',
  'el snapshot congeló el valor que la configuración tenía en ese momento'
);
select is(
  (select snapshot #>> '{entitlements,tarifas}' from config_version limit 1),
  'true',
  'los entitlements efectivos viajan en el snapshot: vienen de `control` como argumento'
);

-- CASO DE DEGRADACIÓN del AC: se edita la config y se sella una versión nueva. La ANTERIOR
-- queda consultable INTACTA.
update parametros set tarifa_kwh_clp = 250;
select lives_ok(
  $$ select crear_config_version('el dueño subió la tarifa') $$,
  'una versión nueva se sella sin tocar la anterior'
);

select is((select count(*)::int from config_version), 2, 'hay dos versiones, no una editada');

-- El orden autoritativo entre versiones es el `id`, no `creada_en`: dentro de UNA transacción
-- `now()` está congelado y dos versiones selladas seguidas comparten timestamp al milisegundo.
-- El UUIDv7 sí es monotónico. Se descubrió acá, con las dos versiones empatadas.

select is(
  (select snapshot #>> '{parametros,0,tarifa_kwh_clp}' from config_version order by id limit 1),
  '190',
  'la versión VIEJA sigue diciendo 190: un turno que la referencia corre con sus reglas'
);
select is(
  (select snapshot #>> '{parametros,0,tarifa_kwh_clp}'
     from config_version order by id desc limit 1),
  '250',
  'y la nueva dice 250'
);

-- APPEND-ONLY (§7.4). Es la mitad que hace que «congelada» sea cierto y no una intención.
select throws_ok(
  $$ update config_version set motivo = 'otra cosa' $$,
  '42501', null,
  'una versión de configuración no se edita: congelada es congelada'
);
select throws_ok(
  $$ delete from config_version $$,
  '42501', null,
  'ni se borra: un turno viejo tiene que poder seguir leyendo la suya'
);

select throws_ok(
  $$ select crear_config_version('   ') $$,
  '23514', null,
  'una versión sin motivo escrito no entra: a los seis meses nadie sabe por qué cambió'
);

select * from finish();
