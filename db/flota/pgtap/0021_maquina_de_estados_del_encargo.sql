-- pgTAP: la máquina de estados del encargo, ejercida contra la base. [AC-FRUT-03]
--
-- Las tres cláusulas del AC son invariantes de BASE, no de servidor, y por eso se prueban acá:
--
--   · los finales SOLO los estampa un trigger — un UPDATE directo del rol de app rebota;
--   · el encargo del contratante nace `solicitado` y su payload deja de ser editable con la
--     aceptación;
--   · reintentar es un encargo NUEVO con `reintento_de`, con la historia completa conservada.
--
-- Un `if` en TypeScript protege hasta que alguien escriba la segunda ruta HTTP que toca la
-- tabla; lo que se prueba acá aguanta también a esa.

select no_plan();

-- La máquina COMPLETA que Alexis fijó el 11-ago-2026 (pregunta 1 de la spec 03). Si mañana
-- aparece un estado más sin que el dueño lo haya decidido, este test lo dice.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'encargo_estado'),
  array['solicitado', 'aceptado', 'asignado', 'publicado', 'entregado', 'no_entregado'],
  'el enum lleva la máquina completa, y EN ORDEN: solicitado → … → entregado | no_entregado'
);

select has_column('encargos', 'creado_por_usuario_id',
  'sin saber quién lo creó, «editable por SU creador» (§3.E1.10) no se puede verificar');

-- ─── El fixture ──────────────────────────────────────────────────────────────────────

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
insert into destinos (nombre) values ('Local del centro');
insert into vehiculos (patente, tipo) values ('KLPN02', 'furgon');

create temporary table f as
  select (select id from empresas_cliente limit 1) as empresa,
         (select id from destinos limit 1)         as destino,
         (select id from vehiculos limit 1)        as vehiculo;

-- ─── El encargo del contratante nace `solicitado` y se edita SOLO hasta la aceptación ─

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select empresa, destino, 12, 'solicitado' from f;

create temporary table pedido as select (select id from encargos limit 1) as id;

-- Mientras está solicitado, el contratante corrige: es su ventana (§3.E1.10).
update encargos set bultos = 15 where id = (select id from pedido);
select is(
  (select bultos from encargos where id = (select id from pedido)),
  15,
  'mientras está solicitado, el contratante corrige su pedido: esa es su ventana (§3.E1.10)'
);

update encargos set estado = 'aceptado' where id = (select id from pedido);

-- El §3.E1.10 habla del CONTRATANTE, así que la ventana se prueba con su rol puesto: el mismo
-- GUC con el que la 0040 lo confina a su empresa.
-- Por `set_config` y no por `SET`: `current_role` es palabra reservada y `SET app.current_role`
-- no parsea, aunque el GUC se lea perfecto con `current_setting`.
select set_config('app.current_role', 'cliente', false);

select throws_ok(
  $$ update encargos set bultos = 40 where id = (select id from pedido) $$,
  '23514', null,
  'aceptado el encargo, cambiarle los bultos rebota: la ventana del contratante se cerró'
);
select throws_ok(
  $$ update encargos set fecha_servicio = fecha_servicio + 1 where id = (select id from pedido) $$,
  '23514', null,
  'y moverle la fecha también: la ruta de mañana ya se armó contra la de hoy'
);
select is(
  (select bultos from encargos where id = (select id from pedido)),
  15,
  'el rebote dejó 0 filas cambiadas: el encargo quedó como estaba'
);

-- Y la otra mitad: la CASA sí corrige lo que todavía está en su bandeja. Un encargo que el
-- operador dio de alta con un dígito de más y que no armó en ninguna ruta se arregla ahí mismo
-- (§5.2 F1); lo que congela el payload para todos es entrar en una ruta, y eso se prueba abajo.
select set_config('app.current_role', '', false);

update encargos set bultos = 16 where id = (select id from pedido);
select is(
  (select bultos from encargos where id = (select id from pedido)),
  16,
  'la casa corrige lo suyo mientras siga en la bandeja: la ventana del §3.E1.10 es del cliente'
);

-- ─── Los finales SOLO los estampa un trigger ─────────────────────────────────────────

select throws_ok(
  $$ update encargos set estado = 'entregado' where id = (select id from pedido) $$,
  '42501', null,
  'la app NO estampa `entregado`: sería cobrar una entrega que nadie capturó en terreno'
);
select throws_ok(
  $$ update encargos set estado = 'no_entregado' where id = (select id from pedido) $$,
  '42501', null,
  'ni `no_entregado`: el fracaso de entrega también lo declara el terreno, no la oficina'
);
select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'aceptado',
  'los dos rebotes dejaron el encargo donde estaba'
);

-- ─── `aceptado → asignado → publicado`: el seguimiento de ruta va EN el encargo ───────

insert into rutas (nombre, vehiculo_id) select 'Ruta de la madrugada', vehiculo from f;
create temporary table r as select (select id from rutas limit 1) as ruta;

insert into paradas (ruta_id, tipo, orden, destino_id)
  select ruta, 'entrega', 1, destino from r, f;
create temporary table p as select (select id from paradas limit 1) as parada;

insert into items (parada_id, encargo_id, qty_planificada)
  select parada, (select id from pedido), 15 from p;

select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'asignado',
  'el ítem que entra en una parada asigna el encargo: el portal responde sin unir tablas'
);

-- Y ahí sí se congela el payload para TODOS, la casa incluida: el encargo ya está en una ruta
-- y cambiarle el destino manda el camión a otra cuadra.
select throws_ok(
  $$ update encargos set bultos = 40 where id = (select id from pedido) $$,
  '23514', null,
  'una vez en la ruta, ni la casa le cambia los bultos: el camión ya se cargó contra ese número'
);

update rutas set publicada_en = now(), version = 1 where id = (select ruta from r);

select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'publicado',
  'publicar el día publica sus encargos: la misma transición que congela la promesa (§5.2 F1)'
);

-- ─── `publicado → entregado`: el cierre de la parada, y NADA más ──────────────────────

update paradas set estado = 'done', resultado = 'exito' where id = (select parada from p);

select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'entregado',
  'el cierre de la parada de entrega es el hecho que estampa el final (§4.5)'
);

-- Y un final es final: reabrirlo borraría el día que se discute.
select throws_ok(
  $$ update encargos set estado = 'aceptado' where id = (select id from pedido) $$,
  '42501', null,
  'un final no se reabre: el reintento es un encargo NUEVO, no el original vuelto atrás'
);

-- ─── Reintento = encargo NUEVO con `reintento_de`, historia completa ──────────────────

insert into encargos (empresa_cliente_id, destino_id, bultos, reintento_de)
  select empresa, destino, 15, (select id from pedido) from f;

select is(
  (select count(*)::int from encargos where reintento_de = (select id from pedido)),
  1,
  'el reintento es una fila NUEVA encadenada al original por `reintento_de` (§4.5, §6)'
);
select is(
  (select estado::text from encargos where id = (select id from pedido)),
  'entregado',
  'y el original quedó intacto: la historia completa se conserva, que es el punto del patrón'
);

-- ─── Un encargo `solicitado` no entra en una ruta ─────────────────────────────────────

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select empresa, destino, 3, 'solicitado' from f;

select throws_ok(
  $$ insert into items (parada_id, encargo_id, qty_planificada)
     select (select parada from p), id, 3 from encargos where estado = 'solicitado' $$,
  '23514', null,
  'la casa no puede rutear lo que todavía no aceptó: falta el paso `solicitado → aceptado`'
);

-- ─── Sin ítems, el encargo vuelve a la bandeja ────────────────────────────────────────
--
-- Pasa al borrar la ruta del día (paradas e ítems caen en cascada). Sin esta vuelta, el encargo
-- quedaría «asignado» a una ruta que ya no existe y nadie podría replanificarlo.

insert into encargos (empresa_cliente_id, destino_id, bultos) select empresa, destino, 7 from f;
create temporary table otro as
  select (select id from encargos where bultos = 7 limit 1) as id;

insert into paradas (ruta_id, tipo, orden, destino_id)
  select ruta, 'carga', 2, destino from r, f;
insert into items (parada_id, encargo_id, qty_planificada)
  select (select id from paradas where orden = 2), (select id from otro), 7;

select is(
  (select estado::text from encargos where id = (select id from otro)),
  'asignado',
  'el encargo entró en la ruta'
);

delete from items where encargo_id = (select id from otro);

select is(
  (select estado::text from encargos where id = (select id from otro)),
  'aceptado',
  'y sin ítems volvió a la bandeja, replanificable'
);

select finish();
