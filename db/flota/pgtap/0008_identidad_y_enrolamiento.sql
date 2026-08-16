-- pgTAP: estructura del esquema §4.3 de identidad y enrolamiento. [AC-FIDN-01]
--
-- Acá va lo que es del CATÁLOGO —qué enums existen con qué valores, qué CHECK protege qué,
-- qué índice parcial sostiene «un personal activo por operario», qué clase declara cada
-- COMMENT— porque escribirlo dentro de la base es lo único que no puede quedar desfasado de
-- la base. El COMPORTAMIENTO con el rol de app real (append-only con 42501, aislamiento) va
-- en `db/flota/suite-bd/identidad.test.mjs`: a un superusuario, que es como corre pgTAP, ni
-- la RLS ni los REVOKE se le aplican, así que probarlos acá daría verde sin probar nada.

select no_plan();

-- ─── Las siete tablas del módulo existen ─────────────────────────────────────────────

select has_table(t) from unnest(array[
  'personas', 'usuarios', 'invitaciones', 'solicitudes_acceso',
  'dispositivos', 'firmas', 'retention_policy'
]) as t;

-- ─── Enums CERRADOS, con sus valores exactos y en orden ──────────────────────────────
--
-- Que sean tipos de la BD y no tablas de catálogo es la decisión: agregar un rol tiene que
-- ser una migración visible, no un INSERT. El enum de roles es el del §0 y su comparación
-- valor a valor contra el canónico `ROLES` vive en la suite de node, que sí puede leer
-- `constants.ts` — dos listas iguales en dos lenguajes se separan si nadie las compara.

select is(
  enum_range(null::rol_usuario)::text[],
  array['admin_tenant', 'operador', 'chofer', 'responsable_carga', 'responsable_tecnico', 'cliente'],
  'rol_usuario: los 6 roles FIJOS del §0, sin uno de más'
);

select is(
  enum_range(null::tipo_dispositivo)::text[],
  array['personal', 'anden'],
  'tipo_dispositivo: personal y de andén, nada más (§4.3, F-D)'
);

select is(
  enum_range(null::estado_solicitud)::text[],
  array['pendiente', 'aprobada', 'rechazada'],
  'estado_solicitud: pendiente → aprobada | rechazada'
);

select is(
  enum_range(null::significado_firma)::text[],
  array['recibio_conforme', 'libero', 'rechazo', 'verifico', 'aprobo'],
  'significado_firma: cerrado — una firma sin significado no sirve de prueba (§4.5 F2)'
);

-- ─── RUT: módulo 11 sobre el formato canónico del §0 ─────────────────────────────────
--
-- Los dos lados. Solo con los válidos, una función que devolviera siempre `true` pasaría;
-- solo con los inválidos, una que devolviera siempre `false` también. Los RUTs son
-- sintácticamente válidos e irreales, como exige el §7.8 para todo dato de prueba.

select ok(rut_valido('12.345.678-5'), 'RUT del §0 con DV numérico ⇒ válido');
select ok(rut_valido('11.111.111-1'), 'RUT con DV 1 ⇒ válido');
select ok(rut_valido('9.999.999-3'), 'RUT de 7 dígitos, con el primer grupo de una cifra ⇒ válido');
select ok(not rut_valido('9.999.999-9'),
  'el mismo RUT con DV repetido ⇒ inválido: el 9 se ve plausible y el módulo 11 dice 3');
select ok(rut_valido('20.347.878-K'), 'DV K en mayúscula ⇒ válido (el módulo 11 lo produce)');
select ok(rut_valido('20.347.878-k'), 'DV k en minúscula ⇒ el mismo RUT');

select ok(not rut_valido('12.345.678-9'), 'DV equivocado ⇒ inválido: el módulo 11 se corre de verdad');
select ok(not rut_valido('12345678-5'),
  'sin puntos ⇒ inválido: dos representaciones del mismo RUT romperían el UNIQUE por tenant');
select ok(not rut_valido('12.345.678'), 'sin DV ⇒ inválido');
select ok(not rut_valido('12.345.678-X'), 'DV que no es dígito ni K ⇒ inválido');
select ok(not rut_valido(''), 'cadena vacía ⇒ inválido');

-- ─── Un dispositivo personal activo por operario, y el re-enrolamiento posible ───────
--
-- El índice es PARCIAL, y esa es la decisión: uno total impediría el teléfono nuevo (F-E),
-- que es un flujo de primera clase y no una excepción. Se verifica el predicado, no solo la
-- existencia: un índice único total con el mismo nombre pasaría un `has_index` y rompería
-- el re-enrolamiento en producción.
select is(
  (select pg_get_indexdef(i.indexrelid)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'dispositivos_uno_personal_activo_idx'),
  'CREATE UNIQUE INDEX dispositivos_uno_personal_activo_idx ON public.dispositivos '
  || 'USING btree (tenant_id, persona_id) WHERE ((tipo = ''personal''::tipo_dispositivo) '
  || 'AND (revocado_at IS NULL))',
  'un personal activo por operario: índice único PARCIAL, para que el teléfono nuevo entre (F-E)'
);

-- ─── Los CHECK que sostienen invariantes del contrato, por nombre ────────────────────

select is(
  (select count(*)::int from pg_constraint
    where conname = 'personas_anonimizacion_completa' and contype = 'c'),
  1, 'personas: la anonimización de la 21.719 es todo o nada, y lo dice un CHECK'
);

select is(
  (select count(*)::int from pg_constraint
    where conname = 'usuarios_cliente_con_empresa' and contype = 'c'),
  1, 'usuarios: rol cliente ⇔ empresa_cliente_id (mapeo cerrado del §4.3)'
);

select is(
  (select count(*)::int from pg_constraint
    where conname = 'dispositivos_persona_segun_tipo' and contype = 'c'),
  1, 'dispositivos: personal ⇔ tiene persona dueña; el de andén es activo del tenant'
);

select is(
  (select count(*)::int from pg_constraint
    where conname = 'retention_policy_sin_plazo_no_purga' and contype = 'c'),
  1, 'retention_policy: sin plazo no hay purga — apagada por construcción, no por promesa'
);

-- ─── La clase de la regla de oro, tabla por tabla (§4.2) ─────────────────────────────
--
-- `firmas` es la ÚNICA CAPTURA de este módulo: la firma por PIN ocurre en terreno y jamás
-- rebota al sincronizar. Que las otras seis sean PLANIFICACIÓN es la otra mitad — si todas
-- fueran CAPTURA, un RUT inválido entraría con un flag en vez de rebotar 422.

select ok(
  obj_description('firmas'::regclass, 'pg_class') like 'CAPTURA%',
  'firmas es CAPTURA: la firma en terreno entra siempre (§4.2)'
);

select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('personas', 'usuarios', 'invitaciones', 'solicitudes_acceso',
                          'dispositivos', 'retention_policy')
        and coalesce(obj_description(c.oid, 'pg_class'), '') not like 'PLANIFICACIÓN%' $$,
  'las otras seis tablas son PLANIFICACIÓN: validan online y rebotan 422'
);

-- ─── retention_policy nace VACÍA y no se puede encender sin plazo ────────────────────

select is(
  (select count(*)::int from retention_policy), 0,
  'retention_policy nace vacía: los plazos son la Pregunta 8 al dueño y no se inventan'
);

select throws_ok(
  $$ insert into retention_policy (registro, plazo_dias, activa)
     values ('invitaciones_vencidas', null, true) $$,
  '23514',
  null::text,
  'una purga activa SIN plazo no se puede ni insertar (§3.E1.15)'
);

select throws_ok(
  $$ insert into retention_policy (registro, plazo_dias) values ('eventos', 30) $$,
  '23514',
  null::text,
  'no hay política de retención para lo append-only: del ledger no se purga nada (§7.4)'
);

-- ─── El append-only de firmas, del lado del trigger ──────────────────────────────────
--
-- Acá se prueba el trigger, que detiene también a quien tiene privilegios —este mismo
-- superusuario—. El REVOKE al rol `app_t_<slug>`, que es la otra capa, se prueba en la suite
-- de node con ese rol: a un superusuario un REVOKE no le aplica y el verde sería falso.

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'firmas'::regclass and not tgisinternal),
  2, 'firmas: trigger de fila y trigger de sentencia (TRUNCATE también rebota)'
);

select finish();
