-- pgTAP: fixture del devengo del seed A — montos HARDCODEADOS calculados a mano, por_entrega
-- POR ENCARGO en parada consolidada multi-empresa, liquidaciones en sus 3 estados finales.
-- [AC-FTAR-14]
--
-- Fuente: §10 (seed del tenant A: farmacia por_bloque_horas $45.000, distribuidora por_entrega
-- $3.500, minimarket por_bulto $1.200) · §2 (misma fuente append-only que `eevd_semanal`) ·
-- §3 de esta spec (por_entrega devengado POR ENCARGO: en la parada consolidada del §3.E1.5
-- nace una línea por encargo entregado con POD vigente, cada una a la empresa de SU encargo,
-- N encargos de la misma empresa ⇒ N líneas, jamás una línea por parada).
--
-- ─── QUÉ CAMBIÓ CONTRA EL TEXTO LITERAL DEL AC, Y POR QUÉ (16-ago-2026) ─────────────────────
--
-- El AC en la spec da por sentado que «distribuidora por_entrega, minimarket por_bulto, 1
-- cerrada con folio / 1 disputada / 1 pagada» son «ejecutables desde ya», y bloquea SOLO la
-- aserción del monto de la farmacia (`por_bloque_horas`, Pregunta 12). Investigando el AC se
-- encontraron DOS cosas más que tampoco son ejecutables hoy, y esta suite las deja escritas en
-- vez de fingir que no existen (mismo espíritu que la corrección de AC-FTAR-13):
--
--   (a) `por_bulto` NO tiene función de devengo. `devengar_entrega()` (0063/0064) es la ÚNICA
--       función que crea líneas y crea EXCLUSIVAMENTE líneas `por_entrega` — el catálogo
--       cerrado de 5 conceptos existe en `tarifas`/`liquidacion_lineas`, pero solo uno de los
--       cinco tiene mecanismo de devengo escrito. Construir `devengar_bulto()` es DDL de
--       sesión supervisada (una función nueva vive en una migración, AGENTS.md), igual que
--       `devengar_entrega()` mismo nació en una migración — así que el minimarket entra a este
--       fixture con su CONTRATO (`tarifas`, $1.200, catálogo cerrado) pero sin línea devengada
--       de `por_bulto`, exactamente como la farmacia con `por_bloque_horas`. La matriz
--       exhaustiva concepto→evidencia sigue abierta en las Preguntas 2–3 del cuerpo.
--   (b) «Cerrada con folio registrado» no tiene dónde aterrizar: `liquidaciones` (0063) no
--       lleva `reference_document_id` — la asociación es EXACTAMENTE lo que
--       [AC-FTAR-16] pide y deja bloqueado por DDL de sesión supervisada. Sembrar una fila de
--       `reference_document` sin FK que la ate a esta liquidación no probaría nada de esta
--       liquidación en particular: sería el verde falso que el §9.2 prohíbe. Este fixture deja
--       la liquidación de la distribuidora simplemente `cerrada`, sin folio.
--
-- Lo que SÍ es plenamente ejecutable, y es lo que prueba esta suite: el grano de `por_entrega`
-- en una parada consolidada de 3 empresas (farmacia y minimarket, además de su concepto
-- bloqueado, también colocan encargos por-entrega sueltos — el Anexo A describe exactamente
-- esa mezcla: «encargos por-entrega también posibles con el mismo mecanismo de ruta» junto a
-- los bloques alternos) y los 3 estados finales de liquidación (`cerrada`, `cerrada` con línea
-- disputada, `pagada`) con montos hardcodeados calculados a mano (sin zona ni recargo horario
-- en el fixture: monto = precio de la vigencia, sin modificadores).

select no_plan();

-- ─── El fixture: 3 empresas del seed A, 1 parada consolidada, 4 encargos, 3 liquidaciones ───

insert into empresas_cliente (rut, razon_social) values
  ('76.111.111-6', 'Distribuidora del seed A'),
  ('77.222.222-K', 'Farmacia del seed A'),
  ('20.347.878-K', 'Minimarket del seed A');

insert into destinos (nombre, comuna) values ('Parada consolidada del seed A', 'Ñuñoa');
insert into rutas (nombre) values ('Ruta madrugada del seed A');
insert into paradas (ruta_id, tipo, orden, destino_id)
  select r.id, 'entrega', 1, d.id
    from rutas r, destinos d
   where r.nombre = 'Ruta madrugada del seed A'
     and d.nombre = 'Parada consolidada del seed A';

-- Los tres contratos «de catálogo» del seed A (§10), tal cual el maestro los describe. El de
-- la farmacia y el del minimarket quedan sembrados COMO CONTRATO —el AC dice que el seed «los
-- usa»— pero ninguno de los dos se devenga en esta suite: (a) arriba.
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_bloque_horas', 45000, timestamptz '2026-01-01 00:00-04'
    from empresas_cliente where rut = '77.222.222-K';
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_bulto', 1200, timestamptz '2026-01-01 00:00-04'
    from empresas_cliente where rut = '20.347.878-K';

-- Los tres contratos `por_entrega` que SÍ se devengan en la parada consolidada — precios
-- distintos entre sí a propósito, para que un monto mal atribuido (línea de una empresa con el
-- precio de otra) no pueda pasar por accidente.
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04'
    from empresas_cliente where rut = '76.111.111-6';
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 4200, timestamptz '2026-01-01 00:00-04'
    from empresas_cliente where rut = '77.222.222-K';
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 2900, timestamptz '2026-01-01 00:00-04'
    from empresas_cliente where rut = '20.347.878-K';

-- 4 encargos en la MISMA parada: 2 de la distribuidora (N encargos de la misma empresa ⇒ N
-- líneas, no 1), 1 de la farmacia, 1 del minimarket — el caso literal del §3.E1.5.
insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select e.id, d.id, 3, 'solicitado'
    from empresas_cliente e, destinos d
   where e.rut = '76.111.111-6' and d.nombre = 'Parada consolidada del seed A';
insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select e.id, d.id, 5, 'solicitado'
    from empresas_cliente e, destinos d
   where e.rut = '76.111.111-6' and d.nombre = 'Parada consolidada del seed A';
insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select e.id, d.id, 2, 'solicitado'
    from empresas_cliente e, destinos d
   where e.rut = '77.222.222-K' and d.nombre = 'Parada consolidada del seed A';
insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select e.id, d.id, 8, 'solicitado'
    from empresas_cliente e, destinos d
   where e.rut = '20.347.878-K' and d.nombre = 'Parada consolidada del seed A';

insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-03-09', date '2026-03-15' from empresas_cliente where rut = '76.111.111-6';
insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-03-09', date '2026-03-15' from empresas_cliente where rut = '77.222.222-K';
insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-03-09', date '2026-03-15' from empresas_cliente where rut = '20.347.878-K';

create temporary table ctx as
select
  (select id from empresas_cliente where rut = '76.111.111-6')            as distribuidora,
  (select id from empresas_cliente where rut = '77.222.222-K')            as farmacia,
  (select id from empresas_cliente where rut = '20.347.878-K')            as minimarket,
  (select id from paradas limit 1)                                       as parada,
  (select l.id from liquidaciones l join empresas_cliente e
     on e.id = l.empresa_cliente_id and e.rut = '76.111.111-6')           as liq_distribuidora,
  (select l.id from liquidaciones l join empresas_cliente e
     on e.id = l.empresa_cliente_id and e.rut = '77.222.222-K')           as liq_farmacia,
  (select l.id from liquidaciones l join empresas_cliente e
     on e.id = l.empresa_cliente_id and e.rut = '20.347.878-K')           as liq_minimarket;

-- Un POD cerrado y vigente por cada encargo, todos entregados el mismo día de la ruta
-- consolidada (§3.E1.5): la parada es UNA, los hechos son cuatro.
create temporary table pods as
select en.id as encargo, en.empresa_cliente_id as empresa,
       row_number() over (partition by en.empresa_cliente_id order by en.id) as ordinal
  from encargos en, ctx
 where en.destino_id = (select destino_id from paradas where id = ctx.parada);

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select p.encargo, ctx.parada, 'exito', timestamptz '2026-03-15 06:30-04', -240
    from pods p, ctx;

-- ─── El devengo: 4 líneas `por_entrega`, cada una a la empresa de SU encargo ────────────────

create temporary table devengado as
select ep.id as pod_id, en.empresa_cliente_id as empresa,
       devengar_entrega(
         ep.id,
         case en.empresa_cliente_id
           when (select distribuidora from ctx) then (select liq_distribuidora from ctx)
           when (select farmacia from ctx)      then (select liq_farmacia from ctx)
           when (select minimarket from ctx)    then (select liq_minimarket from ctx)
         end
       ) as linea
  from entregas_pod ep join encargos en on en.id = ep.encargo_id, ctx
 where ep.parada_id = ctx.parada;

select is(
  (select count(*)::int from liquidacion_lineas l join devengado d on d.linea = l.id),
  4,
  'la parada consolidada del seed A devengó 4 líneas — una por encargo entregado, jamás 1 sola '
  'por parada (§3.E1.5, AC-FTAR-14)'
);

select is(
  (select count(distinct empresa_cliente_id)::int
     from liquidacion_lineas l join devengado d on d.linea = l.id),
  3,
  'las 4 líneas se reparten en las 3 empresas de la parada — cada una a la empresa de SU '
  'encargo, no a la de la parada'
);

-- Distribuidora: 2 encargos ⇒ 2 líneas, cada una a $3.500 (precio de la vigencia única, sin '
-- zona ni recargo horario en este fixture: monto = precio_clp).
select is(
  (select count(*)::int from liquidacion_lineas
    where liquidacion_id = (select liq_distribuidora from ctx)),
  2,
  'N encargos de la MISMA empresa (distribuidora) ⇒ N líneas — el corazón del §3.E1.5'
);
select is(
  (select array_agg(monto_clp order by monto_clp) from liquidacion_lineas
    where liquidacion_id = (select liq_distribuidora from ctx)),
  array[3500::bigint, 3500::bigint],
  'distribuidora: $3.500 por entrega, calculado a mano (seed A, §10) — ambos encargos, mismo '
  'precio de la única vigencia'
);

-- Farmacia: 1 encargo por_entrega ⇒ 1 línea a $4.200 — el AC bloquea el monto de
-- `por_bloque_horas` ($45.000), no este: la farmacia también coloca encargos por-entrega
-- sueltos (Anexo A del maestro), y ESE devengo sí corre por `devengar_entrega()`.
select is(
  (select monto_clp from liquidacion_lineas
    where liquidacion_id = (select liq_farmacia from ctx)),
  4200::bigint,
  'farmacia: su encargo por_entrega devenga $4.200 — el bloqueo de Pregunta 12 es SOLO sobre '
  'el monto de por_bloque_horas, que esta suite ni intenta devengar'
);

-- Minimarket: 1 encargo por_entrega ⇒ 1 línea a $2.900 — igual que la farmacia, el bloqueo es
-- sobre `por_bulto`, no sobre este concepto.
select is(
  (select monto_clp from liquidacion_lineas
    where liquidacion_id = (select liq_minimarket from ctx)),
  2900::bigint,
  'minimarket: su encargo por_entrega devenga $2.900'
);

-- ─── Los dos conceptos bloqueados: contrato sembrado, CERO líneas devengadas de ellos ───────

select is(
  (select precio_clp from tarifas
    where empresa_cliente_id = (select farmacia from ctx) and concepto = 'por_bloque_horas'),
  45000::bigint,
  'el contrato de la farmacia trae su bloque a $45.000 (§10) — sembrado, no devengado'
);
select is(
  (select precio_clp from tarifas
    where empresa_cliente_id = (select minimarket from ctx) and concepto = 'por_bulto'),
  1200::bigint,
  'el contrato del minimarket trae su bulto a $1.200 (§10) — sembrado, no devengado'
);
select is_empty(
  $$ select id from liquidacion_lineas where concepto in ('por_bloque_horas', 'por_bulto') $$,
  'ninguna línea de por_bloque_horas ni de por_bulto nació: ni una tiene función de devengo '
  'hoy (Pregunta 12 la primera; ausencia de devengar_bulto() la segunda, hallazgo de esta '
  'investigación) — el devengo no inventa lo que no puede calcular (§3, Pregunta 8)'
);

-- ─── Los 3 estados finales: cerrada / cerrada con línea disputada / pagada ──────────────────

update liquidaciones set estado = 'cerrada' where id = (select liq_distribuidora from ctx);
update liquidaciones set estado = 'cerrada' where id = (select liq_farmacia from ctx);
update liquidaciones set estado = 'cerrada' where id = (select liq_minimarket from ctx);
update liquidaciones set estado = 'pagada'  where id = (select liq_minimarket from ctx);

select is(
  (select estado from liquidaciones where id = (select liq_distribuidora from ctx)),
  'cerrada',
  'distribuidora: liquidación cerrada, sin folio — la asociación a reference_document es '
  '[AC-FTAR-16], bloqueado por DDL de sesión supervisada'
);
select is(
  (select estado from liquidaciones where id = (select liq_minimarket from ctx)),
  'pagada',
  'minimarket: liquidación pagada — el camino cerrada→pagada completo'
);

insert into personas (rut, nombre) values ('11.111.111-1', 'Operador del seed A');
insert into usuarios (persona_id, rol) select id, 'operador' from personas where rut = '11.111.111-1';

select results_eq(
  format(
    'select id, repetida from disputar_linea(%L, %L, %L, %L, %L)',
    (select l.id from liquidacion_lineas l where l.liquidacion_id = (select liq_farmacia from ctx)),
    (select id from motivos where codigo = 'monto_incorrecto'),
    'el monto no coincide con lo pactado',
    (select id from usuarios limit 1),
    gen_random_uuid()
  ),
  format(
    'values (%L::uuid, false)',
    (select l.id from liquidacion_lineas l where l.liquidacion_id = (select liq_farmacia from ctx))
  ),
  'farmacia: la línea por_entrega queda disputada — el AC pide «1 con línea disputada», y esta '
  'suite la deja sobre la línea que SÍ pudo devengar'
);
select is(
  (select estado from liquidaciones where id = (select liq_farmacia from ctx)),
  'cerrada',
  'la disputa no mueve el estado de la liquidación — sigue cerrada, la línea es la que cambia'
);
select is(
  (select disputa_estado from liquidacion_lineas
    where liquidacion_id = (select liq_farmacia from ctx)),
  'abierta',
  'y la línea de la farmacia quedó con disputa_estado=abierta'
);

-- ─── Las 3 liquidaciones del seed A terminan en 3 estados distintos, exactamente como pide ──
-- el AC: 1 cerrada (sin línea disputada), 1 cerrada CON línea disputada, 1 pagada.

select is(
  (select count(*)::int from liquidaciones l, ctx
    where l.id in (ctx.liq_distribuidora, ctx.liq_farmacia, ctx.liq_minimarket)
      and l.estado = 'cerrada'
      and not exists (
        select 1 from liquidacion_lineas ll
         where ll.liquidacion_id = l.id and ll.disputa_estado is not null
      )),
  1,
  'exactamente 1 liquidación cerrada SIN línea disputada — la distribuidora'
);
select is(
  (select count(*)::int from liquidaciones l, ctx
    where l.id in (ctx.liq_distribuidora, ctx.liq_farmacia, ctx.liq_minimarket)
      and l.estado = 'cerrada'
      and exists (
        select 1 from liquidacion_lineas ll
         where ll.liquidacion_id = l.id and ll.disputa_estado is not null
      )),
  1,
  'exactamente 1 liquidación cerrada CON línea disputada — la farmacia'
);
select is(
  (select count(*)::int from liquidaciones l, ctx
    where l.id in (ctx.liq_distribuidora, ctx.liq_farmacia, ctx.liq_minimarket)
      and l.estado = 'pagada'),
  1,
  'exactamente 1 liquidación pagada — el minimarket'
);

select finish();
