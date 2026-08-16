-- pgTAP: disputa por línea — solo cerrada, ventana, motivo tipado, doble-tap deja 1 disputa.
-- [AC-FTAR-06]
--
-- Fuente: §3.E1.9, §0 (PLAZOS_LEGALES.disputa_liquidacion_dias), §9.3.1 (centinela 1), §4.2.
--
-- El confinamiento del rol `cliente` a SU empresa (§9.3.3, «línea de otra empresa ⇒ 404») NO
-- se prueba acá: pgTAP corre como superusuario y a un superusuario la RLS no se le aplica —
-- mismo motivo por el que AC-FRUT-12 lo prueba en `db/flota/suite-bd/` con el rol de app real,
-- NOSUPERUSER. Esa mitad del AC vive en `db/flota/suite-bd/disputa-por-linea.test.mjs`. Acá se
-- prueba todo lo que SÍ es invariante de base sin necesitar RLS real: la máquina, la ventana,
-- el catálogo de motivos, la idempotencia y el evento.

select no_plan();

-- ─── El fixture: una empresa, dos liquidaciones (una cerrada, una abierta), cuatro líneas ───

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
-- 4 destinos DISTINTOS: `paradas_una_entrega_por_destino` (0037) admite una sola parada
-- `entrega` por destino en cada ruta — 4 líneas necesitan 4 destinos, no 4 paradas al mismo.
insert into destinos (nombre, comuna)
  select 'Local de la disputa ' || gs, 'Ñuñoa' from generate_series(1, 4) gs;
insert into rutas (nombre) values ('Ruta de la disputa');

insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select id, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04' from empresas_cliente
   where rut = '76.111.111-6';

-- Un motivo de OTRO estado_asociado, para el caso «fuera de catálogo» — self-contenido, sin
-- depender de que el tenant de pgTAP haya sembrado `parada_fallida` desde algún vertical.
insert into motivos (codigo, etiqueta, estado_asociado, orden)
values ('motivo_de_otro_catalogo', 'Motivo de otro catálogo', 'parada_fallida', 99);

-- El autor de la disputa. RUT de la lista congelada de fixtures (§7.8, AC-FIDN-21). El §6 de
-- la spec deja al operador/admin registrar una disputa recibida por otro canal, así que el rol
-- alcanza para ejercer la función sin tener que armar una sesión `cliente` completa (eso vive
-- en `suite-bd`, con RLS real).
insert into personas (rut, nombre) values ('11.111.111-1', 'Quien disputa');
insert into usuarios (persona_id, rol)
  select id, 'operador' from personas where rut = '11.111.111-1';

insert into paradas (ruta_id, tipo, orden, destino_id)
  select r.id, 'entrega', d.n, d.id
    from rutas r, (select id, row_number() over (order by nombre) as n from destinos) d
   where r.nombre = 'Ruta de la disputa';

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select e.id, d.id, 2, 'solicitado'
    from empresas_cliente e, destinos d
   where e.rut = '76.111.111-6';

insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
  select enc.id, par.id, 'exito', timestamptz '2026-03-15 10:00-04', -240
    from (select id, row_number() over (order by id) as n from encargos) enc
    join (select id, row_number() over (order by orden) as n from paradas) par on par.n = enc.n;

insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-01-01', date '2026-01-07' from empresas_cliente
   where rut = '76.111.111-6';
insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
  select id, date '2026-01-08', date '2026-01-14' from empresas_cliente
   where rut = '76.111.111-6';

create temporary table ctx as
select
  (select id from usuarios limit 1)                                      as autor_id,
  (select id from liquidaciones order by periodo_inicio limit 1)          as liq_cerrada,
  (select id from liquidaciones order by periodo_inicio desc limit 1)     as liq_abierta,
  (select id from motivos where codigo = 'monto_incorrecto')              as motivo_ok,
  (select id from motivos where codigo = 'motivo_de_otro_catalogo')       as motivo_ajeno;

-- Las 4 líneas nacen del devengo, UNA por POD, en orden — las tres primeras van a la
-- liquidación que se cierra abajo, la cuarta se queda en la que sigue `abierta`.
create temporary table lineas as
select row_number() over (order by pod.id) as n, pod.id as pod_id,
  devengar_entrega(pod.id, case when row_number() over (order by pod.id) <= 3
                                 then (select liq_cerrada from ctx)
                                 else (select liq_abierta from ctx) end) as linea_id
  from entregas_pod pod;

update liquidaciones set estado = 'cerrada' where id = (select liq_cerrada from ctx);

select is(
  (select count(*)::int from liquidacion_lineas where liquidacion_id = (select liq_cerrada from ctx)),
  3,
  'el fixture devengó 3 líneas en la liquidación que se cierra'
);
select is(
  (select count(*)::int from liquidacion_lineas where liquidacion_id = (select liq_abierta from ctx)),
  1,
  'y 1 línea en la que se queda abierta'
);

create temporary table ids as
select
  (select linea_id from lineas where n = 1) as oro,
  (select linea_id from lineas where n = 2) as ventana,
  (select linea_id from lineas where n = 3) as motivo_malo,
  (select linea_id from lineas where n = 4) as no_cerrada;

-- ─── Línea inexistente: 0 filas, sin excepción (mismo código que la línea de otra empresa) ──

select is(
  (select count(*)::int from disputar_linea(
    '00000000-0000-7000-8000-000000000000', (select motivo_ok from ctx), 'nota',
    (select autor_id from ctx), gen_random_uuid())),
  0,
  'una línea inexistente devuelve 0 filas, sin lanzar excepción — la misma forma con la que '
  'el §9.3.3 espera que una línea ajena se vea (AC-FTAR-06)'
);

-- ─── Camino dorado: disputa registrada + evento + huso correcto ─────────────────────────────

create temporary table cliu as select gen_random_uuid() as u;

select results_eq(
  format(
    'select id, repetida from disputar_linea(%L, %L, %L, %L, %L)',
    (select oro from ids), (select motivo_ok from ctx), 'el monto no cuadra',
    (select autor_id from ctx), (select u from cliu)
  ),
  format('values (%L::uuid, false)', (select oro from ids)),
  'la disputa nueva devuelve el id de la línea y repetida=false'
);
select is(
  (select disputa_estado from liquidacion_lineas where id = (select oro from ids)),
  'abierta',
  'la línea quedó con disputa_estado=abierta'
);
select is(
  (select disputa_motivo_id from liquidacion_lineas where id = (select oro from ids)),
  (select motivo_ok from ctx),
  'el motivo tipado quedó grabado en la línea'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidacion_lineas' and objeto_id = (select oro from ids)
      and tipo_id = (select id from evento_tipo where codigo = 'liquidacion_linea.disputada')),
  1,
  'la disputa emitió exactamente 1 evento `liquidacion_linea.disputada` (§4.6)'
);
select isnt(
  (select tz_offset_min from eventos
    where objeto_tabla = 'liquidacion_lineas' and objeto_id = (select oro from ids)),
  0,
  'el huso del evento NO quedó en 0 fijo'
);
select is(
  (select count(*)::int from audit_trail
    where tabla = 'liquidacion_lineas' and registro_id = (select oro from ids)
      and operacion = 'UPDATE'),
  1,
  'la MISMA disputa dejó su fila en audit_trail, por el trigger genérico ya enganchado'
);

-- ─── Centinela 1 (§9.3.1): el replay del MISMO client_uuid deja UNA sola disputa ────────────

select results_eq(
  format(
    'select id, repetida from disputar_linea(%L, %L, %L, %L, %L)',
    (select oro from ids), (select motivo_ok from ctx), 'el monto no cuadra',
    (select autor_id from ctx), (select u from cliu)
  ),
  format('values (%L::uuid, true)', (select oro from ids)),
  'el replay del doble-tap devuelve repetida=true, sin escribir nada nuevo'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidacion_lineas' and objeto_id = (select oro from ids)),
  1,
  'sigue habiendo exactamente 1 evento tras el replay — el centinela 1 en los hechos'
);

-- ─── Una SEGUNDA disputa, con client_uuid DISTINTO, sobre una línea ya disputada ⇒ rebota ───

select throws_ok(
  format(
    'select disputar_linea(%L, %L, %L, %L, %L)',
    (select oro from ids), (select motivo_ok from ctx), 'otro intento', (select autor_id from ctx),
    gen_random_uuid()
  ),
  '23514', null,
  'E1 modela una disputa por línea: un segundo intento distinto sobre la ya disputada rebota'
);
select is(
  (select count(*)::int from eventos
    where objeto_tabla = 'liquidacion_lineas' and objeto_id = (select oro from ids)),
  1,
  'el rebote no sumó un segundo evento'
);

-- ─── Fuera de la ventana de reclamo (PLAZOS_LEGALES.disputa_liquidacion_dias, §0) ───────────

select throws_ok(
  format(
    $$select disputar_linea(%L, %L, %L, %L, %L, (
        select event_time from eventos
         where objeto_tabla = 'liquidaciones' and objeto_id = %L
           and tipo_id = (select id from evento_tipo where codigo = 'liquidacion.cerrada')
      ) + interval '8 days')$$,
    (select ventana from ids), (select motivo_ok from ctx), 'nota', (select autor_id from ctx),
    gen_random_uuid(), (select liq_cerrada from ctx)
  ),
  '23514', null,
  'una disputa que llega 8 días después del cierre está fuera de la ventana ⇒ rebota'
);
select is(
  (select disputa_estado from liquidacion_lineas where id = (select ventana from ids)),
  null,
  'la línea de la ventana vencida quedó sin disputa: 0 cambios'
);

-- Dentro de la ventana, la MISMA línea SÍ se disputa (confirma que el rebote de arriba fue por
-- el tiempo, no por otra cosa).
select is(
  (select repetida from disputar_linea(
    (select ventana from ids), (select motivo_ok from ctx), 'nota', (select autor_id from ctx),
    gen_random_uuid(),
    (select event_time from eventos
      where objeto_tabla = 'liquidaciones' and objeto_id = (select liq_cerrada from ctx)
        and tipo_id = (select id from evento_tipo where codigo = 'liquidacion.cerrada'))
    + interval '6 days'
  )),
  false,
  'la misma línea, dentro de la ventana, sí registra la disputa'
);

-- ─── Sin motivo, o con motivo de OTRO catálogo ⇒ rebota ─────────────────────────────────────

select throws_ok(
  format('select disputar_linea(%L, null, %L, %L, %L)',
    (select motivo_malo from ids), 'nota', (select autor_id from ctx), gen_random_uuid()),
  '23514', null,
  'sin motivo ⇒ rebota (§4.2, motivo tipado obligatorio)'
);
select throws_ok(
  format('select disputar_linea(%L, %L, %L, %L, %L)',
    (select motivo_malo from ids), (select motivo_ajeno from ctx), 'nota',
    (select autor_id from ctx), gen_random_uuid()),
  '23514', null,
  'motivo de OTRO catálogo (estado_asociado distinto) ⇒ rebota'
);
select is(
  (select disputa_estado from liquidacion_lineas where id = (select motivo_malo from ids)),
  null,
  'ninguno de los dos rebotes dejó la línea disputada'
);

-- ─── Liquidación no `cerrada` ⇒ rebota, aunque la línea y el motivo sean válidos ────────────

select throws_ok(
  format('select disputar_linea(%L, %L, %L, %L, %L)',
    (select no_cerrada from ids), (select motivo_ok from ctx), 'nota', (select autor_id from ctx),
    gen_random_uuid()),
  '23514', null,
  'la liquidación de esta línea sigue «abierta»: solo cerrada acepta disputas (§3.E1.9)'
);
select is(
  (select disputa_estado from liquidacion_lineas where id = (select no_cerrada from ids)),
  null,
  'la línea de la liquidación abierta quedó sin disputa'
);

-- ─── El catálogo de motivos de disputa quedó sembrado con sus 4 códigos ─────────────────────

select is(
  (select array_agg(codigo order by orden) from motivos where estado_asociado = 'liquidacion_linea_disputada'),
  array['monto_incorrecto', 'entrega_no_ocurrida', 'evidencia_no_concuerda', 'otro'],
  'el catálogo de motivos de disputa trae sus 4 códigos, en orden'
);
select is(
  (select bool_and(activo) from motivos where estado_asociado = 'liquidacion_linea_disputada'),
  true,
  'los 4 nacen activos'
);

select finish();
