-- pgTAP: el registro por datos de ProveedorTelemetria, en la BASE [AC-FTEL-06] — §4.9, §11.
--
-- El AC lo pide con esas palabras: «activar/desactivar la implementación es UPDATE de una
-- fila, cero cambios de código de pantalla». Acá se prueba que la tabla sostiene exactamente
-- eso, y que la frontera de E1.5 —declarada y telefono_gps sí, OBD/OCPP/etc. no— vive en el
-- CHECK de la base y no solo en un gate de texto.

select no_plan();

select has_table('proveedor_telemetria');

select col_not_null('proveedor_telemetria', c)
  from unnest(array['tenant_id', 'codigo', 'nombre', 'activo']) as c;

select matches(
  obj_description('proveedor_telemetria'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'proveedor_telemetria: declara su clase PLANIFICACIÓN (§4.2) — es catálogo, no hecho'
);

-- ─── Las dos implementaciones de E1.5 nacen sembradas y activas ─────────────────────────
select is(
  (select count(*)::int from proveedor_telemetria),
  2, 'el registro nace con exactamente dos filas: declarada y telefono_gps'
);

select is(
  (select activo from proveedor_telemetria where codigo = 'declarada'),
  true, 'declarada nace activa (§4.9: es la que usa servidor/lecturas.ts desde E1)'
);

select is(
  (select activo from proveedor_telemetria where codigo = 'telefono_gps'),
  true, 'telefono_gps nace activa: la enmienda §11 la admite como implementación REAL de E1.5'
);

-- ─── Activar/desactivar es UPDATE de una fila, y nada más que eso ───────────────────────
select lives_ok(
  $$ update proveedor_telemetria set activo = false where codigo = 'telefono_gps' $$,
  'desactivar una implementación es un UPDATE que vive: cero migración, cero código de pantalla'
);

select is(
  (select activo from proveedor_telemetria where codigo = 'telefono_gps'),
  false, 'el UPDATE se sostuvo: telefono_gps quedó inactiva'
);

select lives_ok(
  $$ update proveedor_telemetria set activo = true where codigo = 'telefono_gps' $$,
  'y reactivarla es el mismo UPDATE, en sentido inverso'
);

-- ─── La frontera de E1.5 vive en el CHECK, no solo en el gate de texto ──────────────────
-- Sin esto, «el gate exige las del registro, sin aflojar el resto» lo cumpliría una tabla que
-- acepta cualquier código y deja la frontera entera en manos de un grep sobre el árbol fuente.
select throws_ok(
  $$ insert into proveedor_telemetria (codigo, nombre, activo) values ('obd', 'OBD-II', false) $$,
  '23514',
  null,
  'una fuente de E4 (obd) no entra al registro ni siquiera INACTIVA — el CHECK la rebota'
);

select throws_ok(
  $$ insert into proveedor_telemetria (codigo, nombre, activo) values ('ocpp', 'OCPP', false) $$,
  '23514',
  null,
  'lo mismo para ocpp: la frontera es cerrada, no una lista que cualquiera extiende con un INSERT'
);

-- ─── Una implementación no se duplica ───────────────────────────────────────────────────
select throws_ok(
  $$ insert into proveedor_telemetria (codigo, nombre, activo) values ('telefono_gps', 'otra fila', false) $$,
  '23505',
  null,
  'telefono_gps ya tiene su fila: un segundo INSERT del mismo código choca con el UNIQUE'
);

select finish();
