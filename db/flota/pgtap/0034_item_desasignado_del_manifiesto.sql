-- pgTAP: el ítem bajado del manifiesto desasigna su encargo, sin borrarlo. [AC-FRUT-24]
--
-- Las tres cláusulas del AC, invariantes de BASE (0070_item_desasignado_del_manifiesto.sql):
--
--   · el ítem bajado NO cierra su encargo `no_entregado`: vuelve a la bandeja (`aceptado`);
--   · el encargo se re-asigna a OTRA ruta del mismo día sin fila `reintento_de`;
--   · el manifiesto conserva su historia completa — la fila de `items` y la del acto de bajada
--     siguen existiendo, ninguna se borra.

select no_plan();

-- ─── El fixture: un encargo asignado, publicado NO todavía, con su sub-manifiesto ────

-- RUT reutilizado de la lista congelada: la misma empresa contratante de los fixtures del
-- módulo 03 (db/flota/ruts-sinteticos.mjs) -- la transacción de la suite se revierte siempre
-- (pgtap.mjs), así que no choca con la del 0021.
insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería del ensayo');
insert into destinos (nombre) values ('Bodega de carga');
insert into destinos (nombre) values ('Local de reparto');
insert into vehiculos (patente, tipo) values ('KLPN24', 'furgon');

create temporary table f as
  select (select id from empresas_cliente limit 1)             as empresa,
         (select id from destinos where nombre = 'Bodega de carga')  as bodega,
         (select id from destinos where nombre = 'Local de reparto') as local,
         (select id from vehiculos limit 1)                    as vehiculo;

insert into encargos (empresa_cliente_id, destino_id, bultos)
  select empresa, local, 9 from f;
create temporary table pedido as select (select id from encargos limit 1) as id;

insert into rutas (nombre, vehiculo_id) select 'Ruta del ensayo', vehiculo from f;
create temporary table r as select (select id from rutas limit 1) as ruta;

insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'carga', 1, bodega from r, f;
insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'entrega', 2, local from r, f;
create temporary table p as
  select (select id from paradas where orden = 1) as carga,
         (select id from paradas where orden = 2) as entrega;

insert into items (parada_id, encargo_id, qty_planificada)
  select entrega, (select id from pedido), 9 from p;
create temporary table it as select (select id from items limit 1) as id;

select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'asignado',
  'el fixture arranca con el encargo asignado a su parada de entrega'
);

insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
  select carga, empresa, now(), -180 from p, f;
create temporary table m as select (select id from manifiestos limit 1) as id;

insert into manifiesto_items (manifiesto_id, item_id, qty_declarada, qty_confirmada)
  select (select id from m), (select id from it), 9, 9;
create temporary table mi as select (select id from manifiesto_items limit 1) as id;

-- ─── (c) el manifiesto conserva su historia: bajar no borra nada ─────────────────────

insert into manifiesto_item_documento (manifiesto_item_id, bajado_motivo)
  select (select id from mi), 'sin factura a la vista, sale en el próximo camión';

select is(
  (select count(*)::int from manifiesto_items where id = (select id from mi)),
  1,
  'la fila del conteo del andén sigue existiendo: append-only, la bajada no la toca'
);

-- El servidor hace esto dentro de la misma transacción que el acto de `manifiesto_item_documento`
-- (AC-FRUT-24, `bajarDelManifiesto`); acá se ejercita el invariante de BASE que dispara.
update items set desasignado_en = now() where id = (select id from it);

select is(
  (select count(*)::int from items where id = (select id from it)),
  1,
  'y la fila de `items` tampoco se borra: queda marcada, no destruida'
);
select isnt(
  (select desasignado_en from items where id = (select id from it)),
  null,
  'la marca queda puesta'
);

-- ─── (a) el encargo NO cierra `no_entregado`: vuelve a la bandeja ────────────────────

select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'aceptado',
  'el ítem desasignado devuelve el encargo a la bandeja -- mismo trigger que el DELETE de la 0048'
);
select is(
  (select reintento_de from encargos where id = (select id from pedido)),
  null,
  'sigue siendo el MISMO encargo: nadie escribió `reintento_de` -- ese patrón es para el camión '
  'que salió y no entregó, no para la carga que se quedó en el andén'
);

-- ─── (b) se re-asigna a OTRA ruta del mismo día, sin `reintento_de` ──────────────────

insert into rutas (nombre, vehiculo_id) select 'Segunda ruta del día', vehiculo from f;
create temporary table r2 as select (select id from rutas where nombre = 'Segunda ruta del día') as ruta;

insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'entrega', 1, local from r2, f;
create temporary table p2 as
  select (select id from paradas where ruta_id = (select ruta from r2)) as entrega;

insert into items (parada_id, encargo_id, qty_planificada)
  select (select entrega from p2), (select id from pedido), 9;

select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'asignado',
  'reasignado a la segunda ruta, el MISMO encargo vuelve a `asignado`'
);
select is(
  (select count(*)::int from encargos where id = (select id from pedido)),
  1,
  'sigue existiendo una sola fila de encargo: la re-asignación no duplicó nada'
);
select is(
  (select reintento_de from encargos where id = (select id from pedido)),
  null,
  'y sigue sin `reintento_de` tras la re-asignación'
);
select is(
  (select count(*)::int from items where encargo_id = (select id from pedido)),
  2,
  'quedan las DOS filas de `items`: la desasignada (historia) y la nueva (activa)'
);
select is(
  (select count(*)::int
     from items where encargo_id = (select id from pedido) and desasignado_en is null),
  1,
  'y solo UNA de las dos cuenta como viva para la parada actual'
);

select finish();
