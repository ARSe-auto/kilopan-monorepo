-- pgTAP: máquina de estados de la liquidación — solo hacia adelante y de a una, evento +
-- audit_trail por transición, cerrada congela líneas. [AC-FTAR-05]
--
-- Fuente: §3.E1.9 (abierta→cerrada→pagada) · §4.6 (evento append-only + audit_trail; estado
-- visible = proyección) · §2.

select no_plan();

-- ─── El fixture: una empresa, una tarifa, un encargo entregado, DOS liquidaciones ───────────

-- RUT de la lista congelada (§7.8, AC-FIDN-21): la MISMA empresa que ya usan las demás suites
-- de este módulo (0026-0029) — cada suite corre en su propia transacción aislada que pgTAP
-- revierte al terminar, así que reusarla no choca con nada.
insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
insert into destinos (nombre, comuna) values ('Local de la máquina de estados', 'Ñuñoa');
insert into rutas (nombre) values ('Ruta de la máquina de estados');

insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04' from empresas_cliente
   where rut = '76.111.111-6';

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select e.id, d.id, 2, 'solicitado'
    from empresas_cliente e, destinos d
   where e.rut = '76.111.111-6' and d.nombre = 'Local de la máquina de estados';

insert into paradas (ruta_id, tipo, orden, destino_id)
  select r.id, 'entrega', 1, d.id
    from rutas r, destinos d
   where r.nombre = 'Ruta de la máquina de estados' and d.nombre = 'Local de la máquina de estados';

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select e.id, p.id, 'exito', timestamptz '2026-03-15 10:00-04', -240
    from encargos e join destinos d on d.id = e.destino_id
    join paradas p on p.destino_id = d.id
   where d.nombre = 'Local de la máquina de estados';

insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-01-01', date '2026-01-07' from empresas_cliente
   where rut = '76.111.111-6';
insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-01-08', date '2026-01-14' from empresas_cliente
   where rut = '76.111.111-6';

create temporary table ctx as
select
  (select id from liquidaciones order by periodo_inicio limit 1)     as liq_salto,
  (select id from liquidaciones order by periodo_inicio desc limit 1) as liq_camino,
  (select ep.id from entregas_pod ep
     join encargos e on e.id = ep.encargo_id
     join destinos d on d.id = e.destino_id
    where d.nombre = 'Local de la máquina de estados') as pod;

-- ─── Salto `abierta→pagada` ⇒ 422, 0 cambios ────────────────────────────────────────────────

select throws_ok(
  $$ update liquidaciones set estado = 'pagada'
      where id = (select liq_salto from ctx) $$,
  '23514', null,
  'abierta→pagada de un salto: la máquina avanza de a una, no se salta «cerrada» (AC-FTAR-05)'
);
select is(
  (select estado from liquidaciones where id = (select liq_salto from ctx)),
  'abierta',
  'el salto rebotado dejó la liquidación intacta: sigue «abierta»'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_salto from ctx)),
  0,
  'el salto rebotado no emitió ningún evento'
);

-- ─── Camino dorado: abierta→cerrada→pagada, de a una ────────────────────────────────────────

select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)),
  0,
  'antes de tocar la máquina, la liquidación del camino dorado no tiene eventos propios'
);

update liquidaciones set estado = 'cerrada' where id = (select liq_camino from ctx);

select is(
  (select estado from liquidaciones where id = (select liq_camino from ctx)),
  'cerrada',
  'abierta→cerrada: transición válida, un paso adelante'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)
      and tipo_id = (select id from evento_tipo where codigo = 'liquidacion.cerrada')),
  1,
  'abierta→cerrada emitió exactamente 1 evento `liquidacion.cerrada` (§4.6)'
);
select is(
  (select payload from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)
      and tipo_id = (select id from evento_tipo where codigo = 'liquidacion.cerrada')),
  jsonb_build_object('desde', 'abierta', 'hacia', 'cerrada'),
  'el payload del evento nombra el antes y el después de la transición'
);
select isnt(
  (select tz_offset_min from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)
      and tipo_id = (select id from evento_tipo where codigo = 'liquidacion.cerrada')),
  0,
  'el huso NO quedó en 0 fijo — Chile en marzo es UTC-3 (verano), jamás 0'
);
select is(
  (select count(*)::int from audit_trail
    where tabla = 'liquidaciones' and registro_id = (select liq_camino from ctx)
      and operacion = 'UPDATE'),
  1,
  'la MISMA transición dejó su fila en audit_trail (§4.6), por el trigger genérico ya '
  'enganchado desde AC-FTAR-03 — nada nuevo que duplicar'
);

-- ─── «Cerrada» congela líneas: ni siquiera el devengo puede insertar ────────────────────────

select throws_ok(
  format('select devengar_entrega(%L, %L)', (select pod from ctx), (select liq_camino from ctx)),
  '23514', null,
  'nueva línea sobre liquidación «cerrada» ⇒ 422, aunque la pida el propio devengo SECURITY '
  'DEFINER (§3.E1.9, texto literal del criterio)'
);
select is(
  (select count(*)::int from liquidacion_lineas where liquidacion_id = (select liq_camino from ctx)),
  0,
  '0 líneas: el rebote dejó la liquidación cerrada sin una sola línea nueva'
);

-- ─── Retroceso `cerrada→abierta` ⇒ 422, 0 cambios ───────────────────────────────────────────

select throws_ok(
  $$ update liquidaciones set estado = 'abierta'
      where id = (select liq_camino from ctx) $$,
  '23514', null,
  'cerrada→abierta es un retroceso: rebota igual que el salto (AC-FTAR-05)'
);
select is(
  (select estado from liquidaciones where id = (select liq_camino from ctx)),
  'cerrada',
  'el retroceso rebotado dejó la liquidación intacta: sigue «cerrada»'
);

-- ─── `cerrada→pagada`: el segundo paso adelante ─────────────────────────────────────────────

update liquidaciones set estado = 'pagada' where id = (select liq_camino from ctx);

select is(
  (select estado from liquidaciones where id = (select liq_camino from ctx)),
  'pagada',
  'cerrada→pagada: segundo y último paso de la máquina'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)
      and tipo_id = (select id from evento_tipo where codigo = 'liquidacion.pagada')),
  1,
  'cerrada→pagada emitió su propio evento `liquidacion.pagada`, distinto del de cerrar'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)),
  2,
  'la liquidación del camino dorado terminó con exactamente 2 eventos: uno por transición'
);
select is(
  (select count(*)::int from audit_trail
    where tabla = 'liquidaciones' and registro_id = (select liq_camino from ctx)
      and operacion = 'UPDATE'),
  2,
  'y 2 filas de audit_trail — una por cada UPDATE que sí pasó la guarda'
);

-- ─── Retroceso `pagada→cerrada` ⇒ 422, 0 cambios (el final tampoco se reabre) ───────────────

select throws_ok(
  $$ update liquidaciones set estado = 'cerrada'
      where id = (select liq_camino from ctx) $$,
  '23514', null,
  'pagada→cerrada es un retroceso desde el estado final: rebota igual que cualquier otro'
);
select is(
  (select estado from liquidaciones where id = (select liq_camino from ctx)),
  'pagada',
  'el retroceso desde «pagada» rebotado dejó la liquidación intacta'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)),
  2,
  'y no sumó un tercer evento: la máquina sigue en 2 transiciones válidas, ni una más'
);

-- ─── Un UPDATE que no toca `estado` no es una transición: 0 eventos nuevos ──────────────────

update liquidaciones set periodo_fin = periodo_fin where id = (select liq_camino from ctx);

select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_camino from ctx)),
  2,
  'un UPDATE que no cambia `estado` no emite evento: la guarda de entrada es `is not distinct`'
);

select finish();
