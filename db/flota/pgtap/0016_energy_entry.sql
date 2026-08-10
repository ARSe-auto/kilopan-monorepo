-- pgTAP: la sesión de recarga y el dinero invisible. [AC-FVEH-08]
--
-- Acá va lo que solo la base sostiene: el enum COMPLETO del §4.6, el trigger que completa el
-- costo desde la tarifa del tenant, y la RLS del §4.8 —que se prueba con el ROL de app real y
-- no con el dueño del esquema, porque contra el dueño toda RLS es transparente y el test
-- pasaría sin haber probado nada—. El 2xx del sync y el replay viven en
-- `apps/flota/e2e/recargas.spec.ts`.

select no_plan();

select has_table('energy_entry');

-- El enum va COMPLETO aunque `fuel` no tenga flujo en E1: el §4.6 lo escribe así, y agregarle
-- un valor después obliga a un ALTER TYPE en producción sobre una tabla append-only.
select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'energia_tipo'),
  array['charge', 'fuel'],
  'energia_tipo lleva los dos valores del §4.6, aunque `fuel` no tenga flujo en E1'
);

select matches(
  obj_description('energy_entry'::regclass, 'pg_class'),
  '^CAPTURA',
  'energy_entry: declara su clase CAPTURA (§4.2) — jamás rebota al sincronizar'
);

-- Dinero en CLP bigint entero (§0, §4.8). El linter vigila el texto; esto, el catálogo.
select col_type_is('energy_entry', 'costo_clp', 'bigint');
-- Y la energía en Wh ENTEROS: un numeric acá es el primer total de kWh que no cuadra.
select col_type_is('energy_entry', 'wh', 'integer');

-- ─── El costo lo pone el trigger, no el chofer ───────────────────────────────────────

insert into vehiculos (patente, tipo) values ('NRG0001', 'furgón');

create temporary table n_ids as
  select (select id from vehiculos where patente = 'NRG0001') as v;

-- Sin tarifa configurada el costo queda NULO. Un cero se sumaría a los totales como si la
-- energía hubiera sido gratis, y el ahorro vs diésel diría de más.
insert into energy_entry (vehiculo_id, type, wh, ts_dispositivo, tz_offset_min)
  select v, 'charge', 10000, now(), -240 from n_ids;

select is(
  (select costo_clp from energy_entry where wh = 10000),
  null,
  'sin tarifa configurada el costo queda NULO: un cero mentiría en los totales'
);

insert into parametros (tarifa_kwh_clp) values (150)
  on conflict (unica) do update set tarifa_kwh_clp = 150;

insert into energy_entry (vehiculo_id, type, wh, ts_dispositivo, tz_offset_min)
  select v, 'charge', 20000, now() + interval '1 minute', -240 from n_ids;

-- 20.000 Wh son 20 kWh; a 150 el kWh, 3.000 pesos ENTEROS.
select is(
  (select costo_clp from energy_entry where wh = 20000),
  3000::bigint,
  'el trigger completa el costo desde la tarifa del tenant, en CLP entero (§4.8)'
);

-- Y si alguien ya lo mandó, el trigger no lo pisa: la boleta real gana sobre la tarifa teórica.
insert into energy_entry (vehiculo_id, type, wh, costo_clp, ts_dispositivo, tz_offset_min)
  select v, 'charge', 30000, 4111, now() + interval '2 minutes', -240 from n_ids;
select is(
  (select costo_clp from energy_entry where wh = 30000),
  4111::bigint,
  'un costo declarado gana sobre la tarifa: la boleta real manda'
);

-- ─── Append-only ─────────────────────────────────────────────────────────────────────

select throws_ok(
  $$ update energy_entry set wh = 1 $$,
  '42501',
  null,
  'una sesión de recarga no se edita: es un hecho del terreno (§4.6)'
);

-- ─── La RLS del §4.8, con el rol de la app y los roles del terreno ──────────────────
--
-- Se prueba con `set role` al rol de app real: contra el dueño del esquema toda RLS es
-- transparente, y el test pasaría en verde sin haber probado nada (centinela 10 §9.3).

select is(
  (select count(*)::int from pg_policies
    where tablename = 'energy_entry' and policyname = 'dinero_sin_chofer' and permissive = 'RESTRICTIVE'),
  1, 'energy_entry lleva la política RESTRICTIVE del §4.8'
);

-- Es de SELECT y de nada más. La parte contraintuitiva del §4.8: el chofer TIENE que poder
-- escribir su sesión de recarga; lo que no puede es leer el monto que el trigger le puso.
select is(
  (select cmd from pg_policies where tablename = 'energy_entry' and policyname = 'dinero_sin_chofer'),
  'SELECT',
  'la RLS de dinero es solo de SELECT: el chofer escribe su captura y no ve el monto'
);

select finish();

-- ─── Ganchos §4.9: `reading` acepta frío SIN seeds de frío [AC-FVEH-14] ─────────────
--
-- El §4.9 lo pide así: la tabla de condiciones VIVA, «sin seeds de frío». Las dos mitades
-- importan y se prueban juntas — que acepte la magnitud (o el gancho estaría muerto) y que
-- nadie la haya sembrado (o una decisión del tenant sería una decisión nuestra).

select is(
  (select count(*)::int from magnitud where codigo in ('temperatura', 'humedad')),
  0,
  'cero seeds de frío: las magnitudes de condición las siembra el vertical que las use (§4.9)'
);

insert into magnitud (codigo, unidad) values ('temperatura', 'centesimas_de_c');

insert into reading (magnitud_id, valor_int, fuente, ts_dispositivo, tz_offset_min)
  select id, -1850, 'declarada', now(), -240 from magnitud where codigo = 'temperatura';

select is(
  (select valor_int from reading r join magnitud m on m.id = r.magnitud_id
    where m.codigo = 'temperatura'),
  -1850,
  '`reading` acepta temperatura en centésimas de °C, negativa incluida (§0, §4.9)'
);

-- Y sigue sin CHECK de rango, igual que para el SOC: una sonda descalibrada no rebota la
-- captura del chofer (§0 fila SOC, §9.3.4).
select is(
  (select count(*)::int from excursion),
  0,
  'el trigger de excursion está VIVO pero INERTE: sin alarm_rules sembradas no deriva nada'
);

-- ─── TODA vista corre con los privilegios de quien consulta [AC-FVEH-13] ────────────
--
-- El defecto que este invariante impide repetir apareció con `energia_semanal`: una vista de
-- PostgreSQL corre por omisión con los privilegios de su DUEÑO, así que sumaba filas que la RLS
-- del §4.8 le negaba al chofer y le devolvía el total. El chofer no veía ninguna fila y veía el
-- monto igual — la fuga exacta que el centinela 10 existe para impedir, con la política intacta.
--
-- Se exige para TODAS y no solo para las de dinero: la próxima vista sobre una tabla con RLS va
-- a tener el mismo agujero, y dos criterios conviviendo es cómo se elige el equivocado.

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname = 'public'
      -- Las vistas que trae la EXTENSIÓN pgtap no son nuestras y no llevan RLS de nadie: se
      -- excluyen por dependencia de extensión y no por nombre, que envejecería con la versión.
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and not ('security_invoker=true' = any (coalesce(c.reloptions, array[]::text[])))),
  0,
  'toda vista del tenant es security_invoker: si no, suma filas que la RLS le niega a quien pregunta'
);

-- Anti-vacuidad: el conteo de cero de arriba sería trivial en una base sin vistas.
select cmp_ok(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')),
  '>', 0,
  'hay vistas que vigilar: el invariante de arriba no pasa por falta de sujeto'
);
