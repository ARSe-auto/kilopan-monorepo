-- pgTAP: ganchos DDL-only y la matriz de honestidad (§4.9, §7.7). [AC-FTEN-15]
--
-- «DDL-only» significa esquema SIN activar, y eso se prueba de dos maneras: que el esquema
-- esté, y que NO haya seeds. Lo segundo es lo que se olvida — un seed de conveniencia
-- convierte una decisión del tenant en una decisión nuestra.
--
-- Y dos cosas que el §4.9 sí pone vivas desde el día uno: el CHECK de la matriz de honestidad
-- y el trigger de excursión, que tiene que estar VIVO pero INERTE. Inerte no es apagado:
-- apagado habría que acordarse de encenderlo.

select no_plan();

select has_table('thermal_profile');
select has_table('alarm_rule');
select has_table('excursion');
select has_table('disposition');
select has_table('proveedor_telemetria');

-- --- DDL-only quiere decir SIN SEEDS -------------------------------------------------------
select is((select count(*)::int from thermal_profile), 0,
  'thermal_profile nace vacía: los perfiles de frío los siembra el tenant que los compre');
select is((select count(*)::int from alarm_rule), 0,
  'alarm_rule nace vacía: sin reglas sembradas no hay nada que evaluar');
select is((select count(*)::int from disposition), 0, 'disposition nace vacía: su UI es E3');
select is((select count(*)::int from excursion), 0, 'excursion nace vacía');

-- La ÚNICA excepción declarada: el registro de la interfaz `ProveedorTelemetria`, que el §4.9
-- pide con sus implementaciones REALES sembradas. No es un seed de negocio: es la declaración
-- de que la interfaz existe, y es lo que vuelve verificable la matriz de honestidad. En E1 era
-- una sola (`declarada`); la enmienda §11 (E1.5) sumó `telefono_gps`, que no exige hardware
-- [AC-FTEL-06]. Lo que ese registro hace posible se prueba en `0040_registro_de_telemetria`.
select results_eq(
  $$ select fuente::text, activo from proveedor_telemetria order by fuente::text $$,
  $$ values ('declarada', true), ('telefono_gps', true) $$,
  'ProveedorTelemetria tiene registradas las implementaciones reales de E1.5 (§4.9, §11)'
);

-- --- La matriz de honestidad, VIVA (§7.7) --------------------------------------------------
insert into thermal_profile (codigo, min_centesimas, max_centesimas)
  values ('frio_2_8', 200, 800);

select lives_ok(
  $$ insert into alarm_rule (thermal_profile_id, tipo, minutos_fuera, activa)
     select id, 'cumulative', 40, false from thermal_profile where codigo = 'frio_2_8' $$,
  'una alarma acumulativa puede EXISTIR apagada: el tenant la deja lista para cuando compre sondas'
);

select throws_ok(
  $$ update alarm_rule set activa = true where tipo = 'cumulative' $$,
  '23514', null,
  'ACTIVARLA sin ninguna fuente que mida temperatura rebota: ni los números tecleados de ' ||
  '«declarada» ni el GPS del teléfono sostienen «estuvo N minutos fuera de rango» (§7.7)'
);

select throws_ok(
  $$ insert into alarm_rule (thermal_profile_id, tipo, minutos_fuera, activa)
     select id, 'cumulative', 40, true from thermal_profile where codigo = 'frio_2_8' $$,
  '23514', null,
  'y crearla ya activa tampoco: el rebote es al ACTIVAR, venga de un INSERT o de un UPDATE'
);

-- Con una fuente que MIDE sola, la misma alarma es honesta y se activa sin problema. Sin este
-- positivo, un trigger que rechazara siempre pasaría los dos mutantes de arriba.
select lives_ok(
  $$ insert into proveedor_telemetria (fuente, activo) values ('sonda_vehiculo', true);
     update alarm_rule set activa = true where tipo = 'cumulative' $$,
  'con una sonda real, la alarma acumulativa se activa: la regla mira la FUENTE, no el tipo'
);

-- Y una alarma instantánea nunca estuvo prohibida: con una lectura basta para saber que se
-- salió de rango, y eso es cierto aunque el número lo haya tecleado alguien.
delete from proveedor_telemetria where fuente = 'sonda_vehiculo';
select lives_ok(
  $$ insert into alarm_rule (thermal_profile_id, tipo, activa)
     select id, 'instantanea', true from thermal_profile where codigo = 'frio_2_8' $$,
  'una alarma instantánea SÍ se puede activar con fuente declarada: no promete duración'
);

-- --- El trigger de excursión: VIVO pero INERTE ---------------------------------------------
insert into magnitud (codigo, unidad) values ('temperatura', 'centesimas_de_grado');

-- Primero la mitad viva: con una regla instantánea activa, una lectura fuera de rango produce
-- su excursión sola, sin que nadie la calcule.
select lives_ok(
  $$ insert into reading (magnitud_id, valor_int, fuente, ts_dispositivo, tz_offset_min)
     select id, 1500, 'declarada', now(), -240 from magnitud where codigo = 'temperatura' $$,
  'la lectura entra (jamás rebota, §4.2) aunque esté fuera de rango'
);
select is((select count(*)::int from excursion), 1,
  'con una regla activa, la excursión se deriva sola desde la lectura');

-- Y ahora la mitad inerte: sin reglas, las mismas lecturas no producen NADA. Es lo que el
-- §4.9 pide — el gancho está vivo para el día que se siembren reglas, no apagado esperando
-- que alguien se acuerde de encenderlo.
delete from excursion;
update alarm_rule set activa = false;
select lives_ok(
  $$ insert into reading (magnitud_id, valor_int, fuente, ts_dispositivo, tz_offset_min)
     select id, 1600, 'declarada', now() + interval '1 minute', -240 from magnitud
      where codigo = 'temperatura' $$,
  'la lectura sigue entrando sin reglas activas'
);
select is((select count(*)::int from excursion), 0,
  'sin alarm_rules activas el trigger no produce nada: inerte, no apagado (§4.9)');

-- --- disposition: append-only por el §7.4 --------------------------------------------------
select is(
  (select count(*)::int from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'disposition'::regclass
      and p.proname = 'rechazar_mutacion_de_hecho' and not t.tgisinternal),
  2,
  'disposition lleva los DOS triggers de append-only: por fila y por TRUNCATE (§7.4)'
);

select lives_ok(
  $$ insert into disposition (objeto_tabla, objeto_id, estado, motivo)
     values ('lot', uuidv7(), 'retenida', 'temperatura fuera de rango en la recepción') $$,
  'una disposición entra'
);
select throws_ok(
  $$ update disposition set estado = 'liberada' $$,
  '42501', null,
  'y no se edita: corregir una disposición es un supersede con motivo y autor (§7.4)'
);
select throws_ok(
  $$ insert into disposition (objeto_tabla, objeto_id, estado, motivo)
     values ('lot', uuidv7(), 'retenida', '   ') $$,
  '23514', null,
  'una disposición sin motivo escrito no entra: retener carga sin razón no es una decisión'
);

select * from finish();
