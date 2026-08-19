-- pgTAP: ProveedorTelemetria como REGISTRO POR DATOS (§4.9, §11). [AC-FTEL-06]
--
-- El AC pide dos cosas y las dos se prueban acá, contra la base y no contra el código:
--
--   1. Que `telefono_gps` esté REGISTRADA como implementación real y que activarla o
--      desactivarla sea un UPDATE de una fila. Si eso exigiera tocar una pantalla, el registro
--      no sería por datos: sería una constante con una tabla al lado.
--   2. Que sumarla NO afloje la matriz de honestidad del §7.7. Este es el que importa: la
--      versión ingenua del trigger (`bool_and(fuente = 'declarada')`) se volvía permisiva sola
--      con la segunda fila activa, y habría desbloqueado las alarmas térmicas acumulativas de
--      todos los tenants sin que nadie comprara una sonda.

select no_plan();

-- --- 1. El registro tiene las DOS implementaciones de E1.5, y ninguna más -------------------
select results_eq(
  $$ select fuente::text, activo from proveedor_telemetria order by fuente::text $$,
  $$ values ('declarada', true), ('telefono_gps', true) $$,
  'el registro trae las dos implementaciones que E1.5 admite, las dos activas (§4.9, §11)'
);

-- Las de E4 NO están sembradas: el enum las conoce desde la 0006, pero conocerlas no es
-- tenerlas. El registro es el que dice cuáles existen de verdad (§3-FUERA).
select is(
  (select count(*)::int from proveedor_telemetria
    where fuente = any (array['obd', 'ocpp', 'api_fabricante',
                              'sonda_vehiculo', 'archivo_logger']::lectura_fuente[])),
  0,
  'ninguna fuente de E4 está registrada: OBD/OEM sigue siendo punto de extensión (§3-FUERA)'
);

-- --- 2. Activar/desactivar es UN UPDATE -----------------------------------------------------
select lives_ok(
  $$ update proveedor_telemetria set activo = false where fuente = 'telefono_gps' $$,
  'desactivar la implementación es un UPDATE de su fila: cero cambios de pantalla (§4.9)'
);
select is(
  (select activo from proveedor_telemetria where fuente = 'telefono_gps'),
  false,
  'y el UPDATE se ve: la fila es la que manda, no una constante del código'
);
select lives_ok(
  $$ update proveedor_telemetria set activo = true where fuente = 'telefono_gps' $$,
  'y volver a activarla también'
);

-- Registrar dos veces la misma implementación no es un catálogo: es una ambigüedad sobre si
-- está activa o no. El UNIQUE de la 0007 lo impide y sigue impidiéndolo con el valor nuevo.
select throws_ok(
  $$ insert into proveedor_telemetria (fuente, activo) values ('telefono_gps', false) $$,
  '23505', null,
  'la misma fuente no se registra dos veces: «activa» tiene que tener UNA respuesta'
);

-- --- 3. La matriz de honestidad NO se aflojó ------------------------------------------------
insert into thermal_profile (codigo, min_centesimas, max_centesimas)
  values ('frio_0_5', 0, 500);

-- El mutante que esta migración estuvo a punto de introducir: con `telefono_gps` ACTIVA, la
-- pregunta vieja («¿la única fuente es declarada?») se responde que no, y la alarma entraría.
select throws_ok(
  $$ insert into alarm_rule (thermal_profile_id, tipo, minutos_fuera, activa)
     select id, 'cumulative', 30, true from thermal_profile where codigo = 'frio_0_5' $$,
  '23514', null,
  'con declarada + telefono_gps activas, la alarma acumulativa SIGUE rebotando: el GPS del ' ||
  'teléfono mide posición, no temperatura (§7.7)'
);

-- Y con `declarada` apagada, dejando `telefono_gps` como única fuente activa, tampoco: la regla
-- mira si alguna MIDE temperatura, no cuántas hay.
update proveedor_telemetria set activo = false where fuente = 'declarada';
select throws_ok(
  $$ insert into alarm_rule (thermal_profile_id, tipo, minutos_fuera, activa)
     select id, 'cumulative', 30, true from thermal_profile where codigo = 'frio_0_5' $$,
  '23514', null,
  'con telefono_gps como ÚNICA fuente activa tampoco: no es «cuántas fuentes», es si alguna mide'
);
update proveedor_telemetria set activo = true where fuente = 'declarada';

-- El positivo, sin el cual un trigger que rechazara siempre pasaría los dos de arriba: una
-- sonda real registrada y activa sí sostiene «estuvo N minutos fuera de rango».
select lives_ok(
  $$ insert into proveedor_telemetria (fuente, activo) values ('sonda_vehiculo', true);
     insert into alarm_rule (thermal_profile_id, tipo, minutos_fuera, activa)
     select id, 'cumulative', 30, true from thermal_profile where codigo = 'frio_0_5' $$,
  'con una sonda registrada la misma alarma se activa: la regla mira la FUENTE, no el tipo'
);

select * from finish();
