-- pgTAP: lo que la BASE sostiene del alta de vehículos. [AC-FVEH-01]
--
-- Acá va lo del CATÁLOGO y lo de los invariantes que no se ven por HTTP: qué columnas son
-- obligatorias (dos, y no más), que el UNIQUE de patente sea POR TENANT, que el CHECK 0–100
-- del SOC viva en esta tabla y en ninguna otra, y que las proyecciones no se dejen escribir a
-- mano. El camino feliz del alta, el 422 de patente duplicada y el conteo de acciones viven en
-- `apps/flota/e2e/vehiculos.spec.ts`, que es donde se puede pedir de verdad.

select no_plan();

select has_table('vehiculos');

-- Las DOS obligatorias del §5.4. `activo`, `external_ids` y `creado_en` también son NOT NULL,
-- pero traen default: no son campos que alguien tenga que llenar para dar de alta.
select col_not_null('vehiculos', c)
  from unnest(array['patente', 'tipo']) as c;

-- Y todo lo demás NULLABLE, que es lo que hace cierto el «resto progresivo» del §5.4. Si
-- mañana alguien pone NOT NULL en `bateria_wh` para «que los datos estén completos», el alta
-- en <2 min se muere ese día y este test lo dice antes del deploy.
select col_is_null('vehiculos', c)
  from unnest(array[
    'capacidad_bultos', 'capacidad_kg', 'bateria_wh', 'autonomia_nominal_km',
    'wh_por_km_base', 'soh_pct', 'odometro', 'soc'
  ]) as c;

-- La patente es única POR TENANT (§4.5), no globalmente: dos empresas distintas pueden tener
-- registrado el mismo camión —un vehículo arrendado que cambió de manos— y un UNIQUE global
-- le impediría al segundo tenant dar de alta su propia flota.
select col_is_unique('vehiculos', array['tenant_id', 'patente']);

-- La clase de la regla de oro (§4.2): el alta es del dueño, con red, y rebota.
select matches(
  obj_description('vehiculos'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'vehiculos: declara su clase PLANIFICACIÓN (§4.2)'
);

-- Los dos triggers enganchados: el guardián de las proyecciones y la auditoría del §3.E1.14.
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'vehiculos'::regclass and not tgisinternal),
  2, 'vehiculos: el guardián de proyecciones y el de auditoría están enganchados'
);

-- ─── El CHECK 0–100 del SOC vive acá y SOLO acá (§0 fila SOC, §9.3.4) ────────────────
select col_has_check('vehiculos', 'soc');

-- La otra mitad, que es la que de verdad se puede romper por descuido: `reading.valor_int`
-- sigue SIN rango. El linter de migraciones vigila el texto; esto vigila el catálogo, que es
-- lo que la base de verdad tiene aplicado.
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'reading'::regclass and c.contype = 'c' and a.attname = 'valor_int'),
  0, 'reading.valor_int sigue sin CHECK de rango: la captura fuera de rango entra con flag'
);

-- ─── Las proyecciones no se escriben a mano ──────────────────────────────────────────

insert into vehiculos (patente, tipo) values ('PGTAP01', 'furgón');

select throws_ok(
  $$ insert into vehiculos (patente, tipo, soc) values ('PGTAP02', 'furgón', 50) $$,
  '23514',
  null,
  'el alta no puede traer SOC: la proyección se llega por `reading` (§4.5)'
);

select throws_ok(
  $$ update vehiculos set odometro = 1000 where patente = 'PGTAP01' $$,
  '23514',
  null,
  'un UPDATE directo del odómetro rebota: la proyección la mantiene el trigger de lecturas'
);

-- Y la puerta que sí abre, para que el guardián no sea una pared sin cerradura: con el GUC del
-- proyector encendido —lo que hará el trigger de `reading` en AC-FVEH-05— la proyección se
-- mueve. Sin esta mitad, el test de arriba pasaría igual con un trigger que rebota SIEMPRE, y
-- el hito siguiente descubriría que la proyección no tiene forma de escribirse.
select set_config('flota.proyectando', 'si', true);
update vehiculos set odometro = 1000, soc = 55 where patente = 'PGTAP01';
select set_config('flota.proyectando', '', true);

select is(
  (select odometro from vehiculos where patente = 'PGTAP01'),
  1000, 'con el GUC del proyector encendido, la proyección del odómetro sí se mueve'
);
select is(
  (select soc::int from vehiculos where patente = 'PGTAP01'),
  55, 'con el GUC del proyector encendido, la proyección del SOC sí se mueve'
);

-- Y el rango 0–100 se sostiene incluso para el proyector: el trigger de AC-FVEH-05 tendrá que
-- CLAMPAR antes de escribir, no confiar en que la lectura venga sana (§0 fila SOC).
select throws_ok(
  $$ select set_config('flota.proyectando', 'si', true);
     update vehiculos set soc = 150 where patente = 'PGTAP01' $$,
  '23514',
  null,
  'ni el proyector puede dejar un SOC fuera de 0–100: el CHECK es de la tabla'
);

select finish();
