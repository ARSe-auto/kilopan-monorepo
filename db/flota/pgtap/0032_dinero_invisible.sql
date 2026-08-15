-- pgTAP: dinero invisible — la RLS del §4.8 probada con el ROL DE APP REAL. [AC-FTAR-09]
--
-- POR QUÉ ESTA SUITE EXISTE TENIENDO YA LA 0016. La 0016 abre su sección de RLS diciendo
-- «se prueba con `set role` al rol de app real» y después NO hace ningún `set role`: mira
-- `pg_policies` y se declara verde. Que la política ESTÉ ESCRITA y que la política NIEGUE son
-- dos hechos distintos, y contra el dueño del esquema (`migrator`) toda RLS es transparente:
-- una suite que consulta como dueño devuelve las filas de montos y pasa igual. Eso es el
-- centinela 10 del §9.3 con nombre y apellido — verde vacuo—, y es justo lo que este AC
-- prohíbe. Acá se hace el `set role` de verdad, a `app_t_<slug>` (LOGIN, NOSUPERUSER,
-- NOBYPASSRLS, cero ownership — `db/flota/rol-app.mjs`), que es el rol con el que la app
-- habla con la base, y recién ahí se cuenta cuántas filas ve el chofer.
--
-- Y ANTES de contar filas se afirma QUIÉN está contando. Si el `set role` no prendiera, el
-- resto de la suite correría como dueño y volvería a ser el verde vacuo que vino a matar.
--
-- El 2xx del cierre de recarga y su replay viven en `apps/flota/e2e/recargas.spec.ts` y
-- `pod-recarga-outbox.spec.ts` (AC-FVEH-08, AC-FPOD-13); lo que acá se prueba es la otra
-- mitad de esa misma frase del §4.8: que ese INSERT del chofer NO REBOTA aunque la política
-- esté puesta, porque es `FOR SELECT` únicamente.

select no_plan();

-- ─── El inventario de tablas de montos ───────────────────────────────────────────────
--
-- El sufijo `_clp` ES la convención de dinero de este esquema (§0), y el mismo criterio usa
-- la 0003. Derivar el inventario del catálogo y no de una lista a mano es lo que hace que la
-- tabla de montos que nazca mañana entre sola a este test.

create temporary table tablas_de_montos on commit drop as
select distinct c.relname::text as tabla
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
 where n.nspname = 'public' and c.relkind = 'r' and a.attname like '%\_clp';

select cmp_ok(
  (select count(*)::int from tablas_de_montos), '>', 0,
  'el inventario de tablas de montos NO está vacío (verde vacuo prohibido)'
);

-- LA DEUDA, CONGELADA. Estas son las tablas de montos que HOY no llevan la política, y la
-- lista es una aserción exacta, no un comentario: si una tabla de montos nueva nace sin
-- política, el `bag_eq` se pone rojo en el acto; y cuando la sesión supervisada aplique
-- `aplicar_rls_de_dinero()` a las que faltan (AC-FTAR-17 — el motor no escribe migraciones),
-- el mismo `bag_eq` se pone rojo hasta que la línea correspondiente salga de acá. Esa doble
-- rojez es el punto: la deuda no puede crecer en silencio ni quedar saldada sin que se note.
create temporary table sin_politica_todavia on commit drop as
select * from (values
  ('tarifas'),                 -- §4.5 rate card — precio_clp
  ('tarifa_zonas'),            -- modificador de zona — monto_clp
  ('tarifa_recargo_horario'),  -- modificador horario — monto_clp
  ('liquidacion_lineas'),      -- §3.E1.9 la línea devengada — monto_clp
  ('parametros')               -- tarifa_kwh_clp / precio_diesel_litro_clp (§4.4)
) as t(tabla);

select bag_eq(
  $$ select tabla from tablas_de_montos m
      where not exists (select 1 from pg_policies p
                         where p.tablename = m.tabla and p.policyname = 'dinero_sin_chofer') $$,
  $$ select tabla from sin_politica_todavia $$,
  'las tablas de montos sin la RLS del §4.8 son EXACTAMENTE las declaradas pendientes (AC-FTAR-17)'
);

-- ─── La forma de la política, en TODA tabla que ya la lleve ──────────────────────────
--
-- Se afirma sobre el conjunto, no sobre una tabla nombrada: el día que la migración aplique
-- el patrón a las cinco pendientes, estas tres aserciones las cubren sin tocar el test.

select cmp_ok(
  (select count(*)::int from pg_policies where policyname = 'dinero_sin_chofer'), '>', 0,
  'al menos una tabla de montos lleva la política: el conjunto afirmado no es vacío'
);

select is_empty(
  $$ select tablename || ' → ' || permissive from pg_policies
      where policyname = 'dinero_sin_chofer' and permissive <> 'RESTRICTIVE' $$,
  'la política de dinero es RESTRICTIVE: una PERMISSIVE se suma con las otras y no niega nada'
);

select is_empty(
  $$ select tablename || ' → ' || cmd from pg_policies
      where policyname = 'dinero_sin_chofer' and cmd <> 'SELECT' $$,
  'la política de dinero es FOR SELECT únicamente (§4.8): una total rebotaría la captura del chofer'
);

-- Y su PERMISSIVE de base. Sin ninguna permissive, RLS le niega a CUALQUIERA y la tabla
-- quedaría invisible también para el operador — un apagón que se «arregla» apagando la RLS.
select is_empty(
  $$ select p.tablename from pg_policies p
      where p.policyname = 'dinero_sin_chofer'
        and not exists (select 1 from pg_policies b
                         where b.tablename = p.tablename and b.permissive = 'PERMISSIVE') $$,
  'toda tabla con la RESTRICTIVE lleva también su PERMISSIVE de base: nadie queda a ciegas'
);

-- ─── El comportamiento, con el rol de app real ───────────────────────────────────────

insert into vehiculos (patente, tipo) values ('DIN0009', 'furgón');

-- Sin tarifa configurada el trigger no inventa un costo: la fila del chofer queda con
-- `costo_clp` NULL y la completa después el operador o el trigger desde `parametros`.
insert into energy_entry (vehiculo_id, type, wh, ts_dispositivo, tz_offset_min)
  select id, 'charge', 41000, now(), -240 from vehiculos where patente = 'DIN0009';

-- El nombre del rol no se escribe a mano: sale de la base en la que corre la suite, así que
-- este test es el mismo contra el canario y contra cualquier tenant (`app_t_<slug>`, §4.1).
do $$ begin execute format('set role %I', 'app_' || current_database()); end $$;

select is(
  current_user, ('app_' || current_database())::name,
  'la suite corre con el ROL DE APP REAL: contra el dueño toda RLS es transparente (centinela 10)'
);

select set_config('app.current_role', 'chofer', true);
select is(
  (select count(*)::int from energy_entry), 0,
  'chofer: SELECT sobre la tabla de montos ⇒ 0 filas (§4.8)'
);

select set_config('app.current_role', 'responsable_carga', true);
select is(
  (select count(*)::int from energy_entry), 0,
  'responsable_carga: SELECT sobre la tabla de montos ⇒ 0 filas (§4.8)'
);

-- La falla va hacia el cierre: `current_setting` devuelve CADENA VACÍA —no NULL— cuando la
-- transacción que hizo el SET LOCAL terminó, así que la transacción siguiente del pool no
-- puede heredar el permiso por olvidarse de declarar quién es.
select set_config('app.current_role', '', true);
select is(
  (select count(*)::int from energy_entry), 0,
  'sin rol declarado ⇒ 0 filas: ante un bug, una política de dinero NIEGA (§7.2)'
);

-- Y del otro lado la política no puede dejar ciego a quien sí manda: si el operador viera
-- cero, las tres aserciones de arriba pasarían con la tabla simplemente vacía.
select set_config('app.current_role', 'operador', true);
select cmp_ok(
  (select count(*)::int from energy_entry), '>', 0,
  'operador: ve los montos — las 0 filas del chofer no son una tabla vacía'
);

-- LA MITAD CONTRAINTUITIVA DEL §4.8: el chofer TIENE que poder cerrar su recarga. La
-- política es `FOR SELECT` justamente para que este INSERT no rebote (§4.2: el flujo del
-- terreno JAMÁS rebota), aunque el que lo escribe no pueda leer después lo que escribió.
select set_config('app.current_role', 'chofer', true);
select lives_ok(
  $$ select registrar_recarga(
       (select id from vehiculos where patente = 'DIN0009'), null, 42000, null, null,
       now() + interval '7 minutes', -240, '00000000-0000-7000-8000-0000000f7a09') $$,
  'chofer: el cierre de recarga entra sin rebotar — la RESTRICTIVE es solo de SELECT'
);

-- Y el replay del MISMO cierre tampoco rebota: el motor de sync reintenta con el mismo
-- `client_uuid` y tiene que recibir la MISMA fila, no un rebote que lo deje girando en la
-- cola para siempre (§4.2, centinela 1 §9.3).
select is(
  (select repetida from registrar_recarga(
     (select id from vehiculos where patente = 'DIN0009'), null, 42000, null, null,
     now() + interval '7 minutes', -240, '00000000-0000-7000-8000-0000000f7a09')),
  true,
  'chofer: el replay devuelve la misma fila y no rebota (§4.2 — cero rebotes en el terreno)'
);

-- POR QUÉ EL CIERRE VA POR `registrar_recarga` Y NO POR UN `insert … on conflict` INLINE, que
-- es la simplificación que cualquiera intentaría al leer el servidor. El árbitro del ON
-- CONFLICT necesita LEER la fila en conflicto, y leerla es justo lo que la política de dinero
-- le niega al chofer: el replay —no el primer intento, el replay— rebota con 42501 y la
-- captura del terreno queda atrapada en el outbox. Por eso la función es SECURITY DEFINER, y
-- por eso esto se afirma acá: sin esta prueba, el día que alguien «simplifique» el servidor a
-- un upsert inline el gate no diría nada y el defecto aparecería recién en terreno, offline.
select throws_ok(
  $$ insert into energy_entry (vehiculo_id, type, wh, ts_dispositivo, tz_offset_min, client_uuid)
       values ((select id from vehiculos where patente = 'DIN0009'), 'charge', 42000,
               now() + interval '9 minutes', -240, '00000000-0000-7000-8000-0000000f7a09')
       on conflict (tenant_id, client_uuid) do nothing $$,
  '42501',
  null,
  'el upsert INLINE sí rebota al chofer: por eso el cierre va por `registrar_recarga` (§4.2, §4.8)'
);

-- El chofer escribió y sigue sin ver nada: ni su propia fila.
select is(
  (select count(*)::int from energy_entry), 0,
  'chofer: escribió su captura y su SELECT sigue devolviendo 0 filas'
);

reset role;

-- Desde el dueño, la fila del chofer está y su costo es NULL: lo completa el operador o el
-- trigger desde `parametros.tarifa_kwh_clp`, nunca un cero que mentiría en los totales.
select is(
  (select costo_clp from energy_entry where wh = 42000),
  null,
  'la captura del chofer quedó con costo_clp NULL, a completar por el operador (§4.8)'
);

select is(
  (select count(*)::int from energy_entry where wh in (41000, 42000)), 2,
  'el replay no duplicó: dos capturas escritas, dos filas — lo que el chofer no ve, la base lo guardó'
);

select * from finish();
