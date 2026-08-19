-- pgTAP: devengo único en la BD — solo la función crea líneas, y el monto lo calcula ella.
-- [AC-FTAR-03]
--
-- Fuente: §7.5 (las líneas SOLO las crea la función `SECURITY DEFINER`) · §4.8 (CLP entero,
-- `round_clp()`, la aritmética de dinero vive en la base) · §3.E1.8 (tarifa aplicable = mayor
-- `vigente_desde` ≤ el instante del hecho).
--
-- Acá va lo que es del ESQUEMA. La otra mitad del candado —que el ROL DE APP tampoco pueda
-- insertar, ni declarándose en curso de devengo— no se puede ejercer con un INSERT desde acá,
-- porque pgTAP corre como migrador; se verifica sobre el catálogo de privilegios del rol real
-- del canario, que `db/flota/rol-app.mjs` deja acotado en cada corrida del runner.

select no_plan();

-- ─── Las dos mitades del candado (§7.5) ─────────────────────────────────────────────────

select has_table('liquidacion_lineas', 'la tabla donde aterriza el devengo (§4.6, §3.E1.9)');
select matches(
  obj_description('liquidacion_lineas'::regclass, 'pg_class'),
  '^PLANIFICACIÓN —',
  'la línea es PLANIFICACIÓN: su mutación rebota tipada, jamás entra degradada (§4.2)'
);

select throws_ok(
  $$ insert into liquidacion_lineas (liquidacion_id, empresa_cliente_id, evidencia_tipo,
                                     evidencia_id, concepto, tarifa_id, precio_base_clp, monto_clp)
     values ('019fe000-0000-7000-8000-00000000000a'::uuid,
             '019fe000-0000-7000-8000-00000000000b'::uuid, 'entrega_pod',
             '019fe000-0000-7000-8000-00000000000c'::uuid, 'por_entrega',
             '019fe000-0000-7000-8000-00000000000d'::uuid, 3500, 3500) $$,
  '42501',
  null,
  'el INSERT directo de una línea rebota con 42501 hasta para el migrador: solo la función devenga'
);

-- La mitad que el trigger no puede cubrir: el REVOKE al rol de app real. Se lee del catálogo y
-- no con un INSERT porque esta suite corre como migrador. «Sin rol» también es rojo: un verde
-- que dependa de que el rol no exista no vigila nada.
select is(
  (select case
     when to_regrole('app_t_canary') is null then 'sin rol de app'
     when has_table_privilege('app_t_canary', 'liquidacion_lineas', 'insert') then 'con INSERT'
     else 'sin INSERT' end),
  'sin INSERT',
  'el rol de app tiene REVOCADO el INSERT sobre liquidacion_lineas (§7.5)'
);
select ok(
  has_table_privilege('app_t_canary', 'liquidacion_lineas', 'select'),
  'y conserva el SELECT: la app LEE la liquidación, lo que no puede es escribir una línea'
);

-- ─── El fixture: dos vigencias, una zona y cuatro entregas ──────────────────────────────
--
-- RUT de la lista congelada (§7.8, §10). Las vigencias son EXPLÍCITAS y lejanas entre sí: lo
-- que este AC prueba es la elección de vigencia por `event_time`, y un fixture que dependiera
-- del reloj de la corrida probaría otra cosa.

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
insert into destinos (nombre, comuna) values ('Local de Ñuñoa', 'Ñuñoa');
insert into destinos (nombre, comuna) values ('Local de Maipú', 'Maipú');
insert into destinos (nombre) values ('Local sin comuna cargada');
insert into rutas (nombre) values ('Ruta del devengo');

insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04' from empresas_cliente;
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 3800, timestamptz '2026-06-01 00:00-04' from empresas_cliente;

-- La zona cubre SOLO Ñuñoa: Maipú queda deliberadamente afuera para que el caso «no calza
-- ninguna zona» sea un dato del fixture y no un olvido.
insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp)
  select id, 'Zona centro', array['Ñuñoa'], 700 from empresas_cliente;

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select (select id from empresas_cliente limit 1), d.id, 4, 'solicitado'
    from destinos d;
-- Un segundo encargo al destino sin comuna: es el de la vigencia nueva, y `entregas_pod` solo
-- admite un POD vigente POR ENCARGO (§4.5).
insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select (select id from empresas_cliente limit 1), id, 4, 'solicitado'
    from destinos where nombre = 'Local sin comuna cargada';

insert into paradas (ruta_id, tipo, orden, destino_id)
  select (select id from rutas limit 1), 'entrega', row_number() over (order by d.nombre), d.id
    from destinos d;

insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-01-01', date '2026-12-31' from empresas_cliente;

/** Un POD cerrado y vigente para el encargo N-ésimo de ese destino, con su reloj de pared. */
create temporary table pods as
with entregas (destino, ordinal, evento) as (
  values ('Local de Ñuñoa',           1, timestamptz '2026-03-15 10:00-04'),
         ('Local de Maipú',           1, timestamptz '2026-03-15 10:00-04'),
         ('Local sin comuna cargada', 1, timestamptz '2026-03-15 10:00-04'),
         ('Local sin comuna cargada', 2, timestamptz '2026-07-01 10:00-04')
)
select e.destino, e.evento,
       (select id from (
          select en.id, row_number() over (order by en.id) as n
            from encargos en join destinos d on d.id = en.destino_id
           where d.nombre = e.destino) q where q.n = e.ordinal) as encargo,
       (select p.id from paradas p join destinos d on d.id = p.destino_id
         where d.nombre = e.destino limit 1) as parada
  from entregas e;

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select encargo, parada, 'exito', evento, -240 from pods;

-- ─── El devengo: la tarifa vigente AL HECHO, y los modificadores en la misma línea ──────

create temporary table devengado as
select p.destino, p.evento,
       devengar_entrega(
         (select ep.id from entregas_pod ep where ep.encargo_id = p.encargo),
         (select id from liquidaciones limit 1)
       ) as linea
  from pods p;

select is(
  (select count(*)::int from liquidacion_lineas),
  4,
  'la función creó una línea por entrega vigente — y es la ÚNICA que pudo crearlas'
);

select is(
  (select l.monto_clp from liquidacion_lineas l
     join devengado d on d.linea = l.id where d.destino = 'Local de Ñuñoa'),
  4200::bigint,
  'Ñuñoa: precio base de la vigencia vieja (3500) + la zona (700), en la MISMA línea (§3.E1.8)'
);

select is(
  (select l.monto_clp from liquidacion_lineas l
     join devengado d on d.linea = l.id where d.destino = 'Local de Maipú'),
  3500::bigint,
  'Maipú no calza con ninguna zona: precio base, cero error (degradación, §4.2)'
);

select is(
  (select l.monto_clp from liquidacion_lineas l
     join devengado d on d.linea = l.id
    where d.destino = 'Local sin comuna cargada'
      and d.evento = timestamptz '2026-03-15 10:00-04'),
  3500::bigint,
  'sin comuna resoluble: precio base de por_entrega, sin modificador y sin rebote'
);

-- El corazón del AC: la evidencia ANTERIOR al cambio de precio devenga el precio VIEJO. Si el
-- devengo tomara «la última tarifa», estas dos filas tendrían el mismo monto.
select is(
  (select l.monto_clp from liquidacion_lineas l
     join devengado d on d.linea = l.id
    where d.destino = 'Local sin comuna cargada'
      and d.evento = timestamptz '2026-07-01 10:00-04'),
  3800::bigint,
  'la entrega POSTERIOR al cambio devenga la vigencia nueva (mayor vigente_desde ≤ event_time)'
);

select is(
  (select t.precio_clp from tarifas t
     join liquidacion_lineas l on l.tarifa_id = t.id
     join devengado d on d.linea = l.id
    where d.destino = 'Local de Ñuñoa'),
  3500::bigint,
  'la línea guarda la vigencia EXACTA que aplicó: el drill-down puede explicar el monto'
);

-- Todo el dinero es CLP entero calculado en la base: ninguna línea trae decimales heredados de
-- un cálculo hecho afuera (§4.8).
select is_empty(
  $$ select id from liquidacion_lineas
      where monto_clp <> precio_base_clp * cantidad + modificadores_clp $$,
  'el monto es exactamente base × cantidad + modificadores, en CLP entero (§0, §4.8)'
);

-- ─── Correr el devengo dos veces no cobra dos veces ─────────────────────────────────────

select is(
  (select devengar_entrega(
     (select ep.id from entregas_pod ep join pods p on p.encargo = ep.encargo_id
       where p.destino = 'Local de Ñuñoa'),
     (select id from liquidaciones limit 1))),
  (select linea from devengado where destino = 'Local de Ñuñoa'),
  'devengar de nuevo la misma evidencia devuelve la línea que ya existe, no una segunda'
);
select is(
  (select count(*)::int from liquidacion_lineas),
  4,
  'y el conteo de líneas no se movió'
);

-- ─── Evidencia que NO devenga ───────────────────────────────────────────────────────────

select is(
  (select devengar_entrega('019fe000-0000-7000-8000-0000000000ff'::uuid,
                           (select id from liquidaciones limit 1))),
  null,
  'una evidencia que no existe no crea línea ni rebota: no hay nada que cobrar'
);

select finish();
