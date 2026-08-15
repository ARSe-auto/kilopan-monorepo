-- pgTAP: línea=evidencia — UNIQUE, evidencia vigente, supersede post-devengo y excursión.
-- [AC-FTAR-04]
--
-- Fuente: §3.E1.9 (UNIQUE(tenant, tipo, id)) · §4.5 (evidencia VIGENTE) · §4.7 (undo
-- post-replay) · §4.9/§9.3.7 (excursión bloquea, jamás crea ni borra).

select no_plan();

-- ─── El fixture: una empresa, una tarifa, tres encargos con destino y parada ────────────────

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
insert into destinos (nombre, comuna) values ('Local de Ñuñoa', 'Ñuñoa');
insert into destinos (nombre, comuna) values ('Local de Providencia', 'Providencia');
insert into destinos (nombre, comuna) values ('Local con excursión', 'Ñuñoa');
insert into rutas (nombre) values ('Ruta de línea=evidencia');

insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04' from empresas_cliente;

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select (select id from empresas_cliente limit 1), id, 4, 'solicitado'
    from destinos;

insert into paradas (ruta_id, tipo, orden, destino_id)
  select (select id from rutas limit 1), 'entrega', row_number() over (order by d.nombre), d.id
    from destinos d;

insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-01-01', date '2026-12-31' from empresas_cliente;

create temporary table ctx as
select
  (select e.id from encargos e join destinos d on d.id = e.destino_id where d.nombre = 'Local de Ñuñoa') as encargo_nunoa,
  (select p.id from paradas p join destinos d on d.id = p.destino_id where d.nombre = 'Local de Ñuñoa') as parada_nunoa,
  (select e.id from encargos e join destinos d on d.id = e.destino_id where d.nombre = 'Local de Providencia') as encargo_providencia,
  (select p.id from paradas p join destinos d on d.id = p.destino_id where d.nombre = 'Local de Providencia') as parada_providencia,
  (select e.id from encargos e join destinos d on d.id = e.destino_id where d.nombre = 'Local con excursión') as encargo_excursion,
  (select p.id from paradas p join destinos d on d.id = p.destino_id where d.nombre = 'Local con excursión') as parada_excursion,
  (select id from liquidaciones limit 1) as liquidacion;

-- ─── UNIQUE(tenant, tipo, id): la segunda línea sobre la misma evidencia rebota ─────────────
--
-- `devengar_entrega()` ya deduplica por su cuenta (0063); acá se ejerce el CANDADO, no la
-- disciplina de la función: con la marca `app.devengo_en_curso` levantada A MANO —fuera del
-- bloque que `throws_ok` corre en su propia subtransacción, para que el SET LOCAL no se
-- deshaga cuando el INSERT aborte— un segundo INSERT directo sobre la MISMA evidencia tiene
-- que chocar con el UNIQUE (23505), no con el 42501 del trigger (ya probado en la 0028): son
-- dos guardarraíles distintos y este AC agrega el que faltaba.

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select encargo_nunoa, parada_nunoa, 'exito', timestamptz '2026-03-15 10:00-04', -240 from ctx;

create temporary table linea_nunoa as
select devengar_entrega(
  (select id from entregas_pod join ctx on encargo_id = ctx.encargo_nunoa),
  (select liquidacion from ctx)
) as id;

select isnt((select id from linea_nunoa), null, 'la entrega de Ñuñoa devengó su línea (fixture de control)');

select set_config('app.devengo_en_curso', 'si', true);
select throws_ok(
  $$
    insert into liquidacion_lineas (
      liquidacion_id, empresa_cliente_id, evidencia_tipo, evidencia_id, concepto, tarifa_id,
      precio_base_clp, monto_clp
    )
    select l.liquidacion_id, l.empresa_cliente_id, l.evidencia_tipo, l.evidencia_id, l.concepto,
           l.tarifa_id, l.precio_base_clp, l.monto_clp
      from liquidacion_lineas l limit 1
  $$,
  '23505',
  null,
  'una segunda línea sobre la MISMA evidencia viola el UNIQUE(tenant, tipo, id) — el candado, '
  'no solo la disciplina de la función (§3.E1.9)'
);
select set_config('app.devengo_en_curso', '', true);

-- ─── Evidencia supersedida ANTES del devengo: 0 líneas, mirando desde CUALQUIER lado ────────
--
-- «Vigente» (§4.5) es DOBLE: la fila propia no puede ser ELLA MISMA una corrección
-- (`supersede_id is not null`, el caso literal del AC), y tampoco puede haber sido corregida
-- por otra —seguir la cadena, como pide el comentario de la 0055—; sin la segunda mitad,
-- devengar con el id de la fila ORIGINAL seguiría cobrando aunque ya exista su corrección.

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select encargo_providencia, parada_providencia, 'exito', timestamptz '2026-03-15 10:00-04', -240
    from ctx;
insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min,
                           supersede_id, supersede_motivo, actor_id)
  select encargo_providencia, parada_providencia, 'exito', timestamptz '2026-03-15 10:05-04', -240,
         id, 'correccion_antes_del_devengo', uuidv7()
    from entregas_pod ep join ctx on ep.encargo_id = ctx.encargo_providencia
   where ep.supersede_id is null;

select is(
  (select devengar_entrega(
     (select id from entregas_pod ep join ctx on ep.encargo_id = ctx.encargo_providencia
       where ep.supersede_id is null),
     (select liquidacion from ctx))),
  null,
  'la fila ORIGINAL, ya corregida antes de devengar, no es vigente: algo la supersedió (§4.5)'
);
select is(
  (select devengar_entrega(
     (select id from entregas_pod ep join ctx on ep.encargo_id = ctx.encargo_providencia
       where ep.supersede_id is not null),
     (select liquidacion from ctx))),
  null,
  'y la fila de la CORRECCIÓN tampoco: ella misma trae `supersede_id` seteado (§4.5, literal)'
);
select is(
  (select count(*)::int from liquidacion_lineas l
     join entregas_pod ep on ep.encargo_id = (select encargo_providencia from ctx)
    where l.evidencia_id = ep.id),
  0,
  '0 líneas nacidas de ese POD, mirando desde cualquiera de las dos filas de la corrección'
);

-- ─── POD devengado y LUEGO supersedido con motivo=undo: línea bloqueada + review_queue ──────

select is(
  (select count(*)::int from review_queue where origen = 'liquidacion.linea_bloqueada'),
  0,
  'antes del supersede post-devengo, la cola «Por revisar» no tiene nada de este origen'
);
select is(
  (select bloqueada from liquidacion_lineas where id = (select id from linea_nunoa)),
  false,
  'recién devengada, la línea de Ñuñoa NO está bloqueada'
);

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min,
                           supersede_id, supersede_motivo, actor_id)
  select encargo_nunoa, parada_nunoa, 'exito', timestamptz '2026-03-15 10:00-04', -240,
         id, 'undo', uuidv7()
    from entregas_pod join ctx on encargo_id = ctx.encargo_nunoa
   where supersede_id is null;

select is(
  (select bloqueada from liquidacion_lineas where id = (select id from linea_nunoa)),
  true,
  'supersede DESPUÉS de devengada (motivo=undo, §4.7) ⇒ la línea queda BLOQUEADA'
);
select is(
  (select count(*)::int from liquidacion_lineas where evidencia_id = (select id from linea_nunoa)),
  1,
  'el trigger de supersede jamás borra la línea: sigue existiendo exactamente UNA, bloqueada'
);
select is(
  (select count(*)::int from review_queue where origen = 'liquidacion.linea_bloqueada'),
  1,
  'y deja UNA fila en review_queue explicando por qué (Pregunta 11 de la spec 06)'
);
select ok(
  (select nota ~ (select id::text from linea_nunoa) from review_queue
    where origen = 'liquidacion.linea_bloqueada'),
  'la nota nombra la línea exacta que bloqueó — no un aviso genérico'
);

-- ─── 0 líneas huérfanas sobre el fixture completo (§9.3.7) ──────────────────────────────────
--
-- «Huérfana» = línea cuya evidencia está supersedida SIN que la línea haya quedado bloqueada.
-- El fixture de arriba generó el único caso de supersede-post-devengo que existe en esta
-- corrida, y el trigger ya la marcó — así que la vista tiene que estar vacía.

select is_empty(
  $$ select id from liquidacion_lineas_huerfanas $$,
  '0 líneas huérfanas: toda evidencia supersedida post-devengo quedó bloqueada (§9.3.7)'
);

-- ─── Excursión en la parada: BLOQUEA, jamás crea la línea ───────────────────────────────────
--
-- El gancho del §4.9 está inerte en E1 (sin alarm_rules activas el trigger `reading_detecta_
-- excursion` no produce nada solo): acá se ACTIVA una regla de prueba para que el trigger VIVO
-- produzca la excursión sola, que es como se ejerce un gancho inerte de verdad — no con un
-- INSERT manual en `excursion`, que probaría otra tabla y no el gancho.

insert into magnitud (codigo, unidad) values ('temp_frio_prueba', 'centesimas_c');
insert into thermal_profile (codigo, min_centesimas, max_centesimas) values ('perfil_prueba', -500, 500);
insert into alarm_rule (thermal_profile_id, tipo, activa)
  select id, 'instantanea', true from thermal_profile where codigo = 'perfil_prueba';

insert into reading (magnitud_id, valor_int, fuente, parada_id, ts_dispositivo, tz_offset_min)
  select (select id from magnitud where codigo = 'temp_frio_prueba'), 900, 'declarada',
         parada_excursion, timestamptz '2026-03-15 10:00-04', -240
    from ctx;

select isnt(
  (select count(*)::int from excursion), 0,
  'con una alarm_rule activa, el gancho §4.9 (inerte por default) SÍ produjo una excursión'
);

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select encargo_excursion, parada_excursion, 'exito', timestamptz '2026-03-15 11:00-04', -240
    from ctx;

select is(
  (select devengar_entrega(
     (select ep.id from entregas_pod ep join ctx on ep.encargo_id = ctx.encargo_excursion),
     (select liquidacion from ctx))),
  null,
  'excursión en la parada ⇒ el devengo NO crea la línea (§4.9, §9.3.7)'
);
select is(
  (select count(*)::int from liquidacion_lineas l
     join entregas_pod ep on ep.id = l.evidencia_id
    where ep.encargo_id = (select encargo_excursion from ctx)),
  0,
  'jamás la crea: count(líneas) de esa evidencia es 0 antes Y después de intentar devengar'
);

select finish();
