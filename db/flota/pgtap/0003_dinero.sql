-- pgTAP: tipado de dinero y función única de redondeo (§0, §4.8). [AC-FTEN-09]
--
-- El catálogo de columnas de dinero son las `*_clp`: el sufijo ES la convención, y el mismo
-- criterio corre en el linter de migraciones (que atrapa el `numeric` ANTES de que llegue a
-- una base) y acá (que lo atrapa en el catálogo real, incluido lo que alguien haya alterado
-- a mano).
--
-- Y la primera prueba de todas es que el catálogo NO esté vacío. Este test se escribió cuando
-- todavía no había ninguna tabla de montos; sin ella habría estado verde meses sin mirar nada.

select no_plan();

create temporary table columnas_de_dinero on commit drop as
select c.relname as tabla, a.attname as columna, format_type(a.atttypid, a.atttypmod) as tipo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
 where n.nspname = 'public' and c.relkind = 'r' and a.attname like '%\_clp';

select cmp_ok(
  (select count(*)::int from columnas_de_dinero), '>', 0,
  'el catálogo de columnas de dinero NO está vacío (verde vacuo prohibido)'
);

select is_empty(
  $$ select tabla || '.' || columna || ' → ' || tipo
       from columnas_de_dinero where tipo <> 'bigint' $$,
  'toda columna de monto es CLP bigint entero: jamás numeric, jamás float (§0, §4.8)'
);

-- Las dos columnas reales que el AC nombra ya están en el catálogo al cierre del módulo.
select bag_eq(
  $$ select tabla || '.' || columna from columnas_de_dinero
      where tabla = 'parametros' $$,
  $$ values ('parametros.tarifa_kwh_clp'), ('parametros.precio_diesel_litro_clp') $$,
  'las columnas de monto reales de este módulo están en el catálogo ejercitado'
);

-- --- round_clp(): LA función de redondeo --------------------------------------------------
select has_function('round_clp', array['numeric'], 'round_clp(numeric) existe');
select function_returns('round_clp', array['numeric'], 'bigint',
  'round_clp devuelve bigint: el resultado es CLP entero, no otro numeric');
select is(
  (select provolatile from pg_proc where proname = 'round_clp'),
  'i'::"char",
  'round_clp es IMMUTABLE: el mismo monto redondea igual siempre'
);

select is(round_clp(1499.4), 1499::bigint, 'redondea hacia abajo por debajo del medio');
select is(round_clp(1499.5), 1500::bigint, 'el 0,5 se aleja del cero, como en una boleta');
select is(round_clp(-1499.5), -1500::bigint, 'y también hacia el otro lado');
select is(round_clp(0), 0::bigint, 'el cero es cero');
select is(round_clp(null), null::bigint, 'STRICT: sin monto no hay redondeo inventado');

-- ÚNICA (§0). Si mañana aparece un segundo redondeo, dos partes del sistema dejan de
-- coincidir por un peso y nadie sabe cuál manda.
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (p.proname ~ 'round|redonde') and p.proname <> 'round_clp' $$,
  'round_clp es la ÚNICA función de redondeo del esquema (§0)'
);

select * from finish();
