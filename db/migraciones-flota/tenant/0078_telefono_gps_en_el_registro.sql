-- 0078 — `telefono_gps` registrada como implementación REAL de ProveedorTelemetria [AC-FTEL-06]
--
-- Fuente: §11 (E1.5) y §4.9 (registro por datos). Segunda mitad de la 0077: ahí entró el valor
-- al enum, acá entra la FILA — separadas porque un valor de enum no se puede usar en la misma
-- transacción que lo agrega.
--
-- Lo que esta migración hace posible, y es todo el AC: activar o desactivar `telefono_gps` es
-- `update proveedor_telemetria set activo = ... where fuente = 'telefono_gps'`. Ninguna pantalla
-- cambia, ningún `if` se agrega, ningún deploy hace falta. Eso es lo que el §4.9 quiere decir
-- con «registro por datos», y hasta hoy la interfaz tenía UNA implementación (`declarada`) y por
-- eso el registro no se distinguía de una constante.
--
-- OBD, OCPP, `api_fabricante`, `sonda_vehiculo` y `archivo_logger` NO se siembran: siguen siendo
-- puntos de extensión del §3-FUERA hasta que el dueño elija proveedor (Pregunta 1 de la spec
-- 09). El enum las tiene desde la 0006; el registro es el que dice cuáles EXISTEN de verdad, y
-- `db/flota/gate-ganchos-e1.mjs` es el que impide que una de ellas aparezca en el árbol de
-- código sin pasar por acá.

insert into proveedor_telemetria (fuente, activo) values ('telefono_gps', true);

-- --- La matriz de honestidad (§7.7) NO se afloja al sumar la fuente nueva -------------------
--
-- Acá estaba el daño silencioso. La versión de la 0007 preguntaba `bool_and(fuente =
-- 'declarada')`: «¿la única fuente activa del tenant es gente tecleando números?». Con una
-- segunda fila activa esa pregunta se responde `false` sola, y el trigger dejaría de rebotar —
-- o sea que registrar el GPS del teléfono habría DESBLOQUEADO las alarmas térmicas
-- acumulativas de todos los tenants, sin que nadie comprara una sonda y sin que ningún test de
-- la 0007 se pusiera rojo.
--
-- Y sería falso por partida doble: el teléfono del chofer mide POSICIÓN, no temperatura. No es
-- que tenga poca resolución térmica; es que no tiene ninguna. «Estuvo 40 minutos fuera de
-- rango» sigue sin poder sostenerse.
--
-- La pregunta correcta no era «¿es declarada?» sino «¿alguna fuente activa MIDE temperatura
-- sola?». Se escribe por su complemento —la lista de las que no— porque es la que crece con
-- cada implementación sin hardware que sume el §11, y porque una fuente térmica nueva tiene que
-- entrar habilitando por defecto, no quedar olvidada del lado de las que mienten.
create or replace function honestidad_de_la_alarma() returns trigger
  language plpgsql as $$
  declare
    v_sin_resolucion_termica boolean;
  begin
    if not new.activa or new.tipo <> 'cumulative' then
      return new;
    end if;
    select bool_and(fuente = any (array['declarada', 'telefono_gps']::lectura_fuente[]))
      into v_sin_resolucion_termica
      from proveedor_telemetria where activo;
    if coalesce(v_sin_resolucion_termica, true) then
      raise exception
        'no se puede activar una alarma acumulativa en un tenant sin ninguna fuente que MIDA '
        'temperatura sola: «declarada» son números tecleados y «telefono_gps» mide posición, y '
        'ninguna de las dos sostiene «estuvo N minutos fuera de rango» (§7.7 matriz de '
        'honestidad)'
        using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

comment on function honestidad_de_la_alarma() is
  'Matriz de honestidad del §7.7: prohíbe ACTIVAR una alarma acumulativa mientras ninguna '
  'fuente activa del registro mida temperatura sola. `declarada` (tecleada) y `telefono_gps` '
  '(mide posición) no cuentan [AC-FTEL-06].';

comment on table proveedor_telemetria is
  'PLANIFICACIÓN — qué fuentes de telemetría tiene activas el tenant. Es un REGISTRO POR DATOS '
  '(§4.9): activar o desactivar una implementación es un UPDATE de su fila, jamás un cambio de '
  'pantalla. E1.5 (§11) tiene dos implementaciones REALES sembradas —`declarada` y '
  '`telefono_gps`, las que no exigen hardware—; OBD/OEM sigue siendo punto de extensión. '
  'Registrarlas es lo que vuelve verificable la matriz de honestidad del §7.7 [AC-FTEL-06].';
