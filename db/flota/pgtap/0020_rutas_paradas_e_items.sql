-- pgTAP: la agrupación como invariante de la BD, no como convención del servidor. [AC-FRUT-04]
--
-- Lo que este archivo protege es una sola frase del §3.E1.5: N encargos de ≥2 empresas al mismo
-- destino son UNA parada. Si eso viviera solo en el `group by` del servidor, el día que otro
-- camino inserte la segunda parada el camión hace dos veces la misma cuadra y nadie se entera
-- hasta que llama el chofer. Acá se ejerce que la base lo rebota.
--
-- Y su gemelo: que agrupar NO borre de quién es cada bulto. El sub-manifiesto del andén y la
-- ecuación de cierre son por empresa (§5.2 F2, §3.E1.6); una agrupación que sume los bultos en
-- un solo ítem sería más corta y dejaría al módulo entero sin el dato que necesita.

select no_plan();

select has_table(t) from unnest(array['rutas', 'paradas', 'items', 'cargo_type_requirement']) as t;

select matches(
  obj_description(t::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  t || ': declara su clase PLANIFICACIÓN (§4.2) — se arma con red, acá SÍ se rebota'
) from unnest(array['rutas', 'paradas', 'items', 'cargo_type_requirement']) as t;

-- El enum del §4.5 va completo aunque E1 no produzca `optimizada`: la genera el VRP en E2, y
-- agregarle un valor después es un ALTER TYPE en producción.
select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'ruta_origen'),
  array['maestra', 'manual', 'optimizada'],
  'ruta_origen lleva los tres del §4.5, aunque el VRP sea E2'
);
select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'parada_tipo'),
  array['carga', 'entrega', 'recarga'],
  'parada_tipo: carga, entrega y recarga — la de recarga es un bloque de agenda (§5.2 F4)'
);

-- ─── El fixture: dos empresas, un destino compartido y otro propio ────────────────────

insert into empresas_cliente (rut, razon_social) values
  ('76.111.111-6', 'Panadería de prueba'),
  ('77.222.222-K', 'Pastelería de prueba');
insert into destinos (nombre) values ('Sucursal compartida'), ('Local del centro');
insert into vehiculos (patente, tipo) values ('KLPN01', 'furgon');

create temporary table f as
  select (select id from empresas_cliente where rut = '76.111.111-6') as panaderia,
         (select id from empresas_cliente where rut = '77.222.222-K') as pasteleria,
         (select id from destinos where nombre = 'Sucursal compartida') as compartido,
         (select id from destinos where nombre = 'Local del centro')    as propio,
         (select id from vehiculos where patente = 'KLPN01')           as vehiculo;

insert into encargos (empresa_cliente_id, destino_id, bultos)
  select panaderia, compartido, 12 from f;
insert into encargos (empresa_cliente_id, destino_id, bultos)
  select pasteleria, compartido, 8 from f;

insert into rutas (nombre, vehiculo_id) select 'Ruta de la madrugada', vehiculo from f;

create temporary table r as select (select id from rutas limit 1) as ruta;

-- ─── EL invariante: una sola entrega por destino en cada ruta ─────────────────────────

insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'entrega', 1, compartido from r, f;

select throws_ok(
  $$ insert into paradas (ruta_id, tipo, orden, destino_id)
     select ruta, 'entrega', 2, compartido from r, f $$,
  '23505', null,
  'dos paradas de entrega al mismo destino en la misma ruta: el camión haría dos veces la cuadra'
);

-- Y las tres formas en que el índice NO debe estorbar, sin las cuales lo anterior lo cumpliría
-- un índice único a secas — que rompería el resto del módulo.
insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'entrega', 2, propio from r, f;
insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'carga', 3, compartido from r, f;
insert into paradas (ruta_id, tipo, orden, destino_id) select ruta, 'carga', 4, compartido from r, f;
select pass('dos paradas de CARGA al mismo destino sí se pueden: una ruta pasa dos veces por el horno');

insert into rutas (nombre, vehiculo_id) select 'Ruta de la tarde', vehiculo from f;
insert into paradas (ruta_id, tipo, orden, destino_id)
  select (select id from rutas where nombre = 'Ruta de la tarde'), 'entrega', 1, compartido from f;
select pass('el mismo destino en OTRA ruta se entrega igual: el invariante es por ruta');

-- ─── Lo que la agrupación NO puede borrar: de quién es cada bulto ─────────────────────

create temporary table p as
  select (select id from paradas where tipo = 'entrega' and ruta_id = (select ruta from r)
            and destino_id = (select compartido from f)) as compartida;

insert into items (parada_id, encargo_id, qty_planificada)
  select compartida, e.id, e.bultos from p, encargos e where e.destino_id = (select compartido from f);

select is(
  (select count(distinct empresa_cliente_id)::int from items where parada_id = (select compartida from p)),
  2,
  'UNA parada con los ítems de DOS empresas: agrupar no borra el desglose (§3.E1.5)'
);
select is(
  (select sum(qty_planificada)::int from items where parada_id = (select compartida from p)),
  20,
  'y los bultos de las dos están, cada uno con su dueño'
);

-- La empresa del ítem la estampa el trigger desde el encargo: no es un dato que se pueda
-- escribir distinto. Un ítem atribuido a la empresa equivocada es carga que aparece en el
-- sub-manifiesto de otro y una ecuación de cierre que cuadra por casualidad.
insert into items (parada_id, encargo_id, empresa_cliente_id, qty_planificada)
  select (select id from paradas where tipo = 'entrega' and destino_id = (select propio from f)
            and ruta_id = (select ruta from r)),
         (select id from encargos where empresa_cliente_id = (select panaderia from f) limit 1),
         (select pasteleria from f),  -- mentira deliberada
         5;
select is(
  (select i.empresa_cliente_id from items i
     join encargos e on e.id = i.encargo_id
    where i.qty_planificada = 5),
  (select panaderia from f),
  'la empresa del ítem la estampa el trigger desde el encargo, aunque se le mande otra'
);

-- ─── Las cantidades del terreno nacen NULL, y NULL no es cero ────────────────────────

select is(
  (select count(*)::int from items where qty_entregada is not null or qty_rechazada is not null),
  0,
  'qty_entregada/rechazada nacen NULL: un cero diría «se entregaron cero» sin haber ido'
);

-- ─── Los ganchos vivos del §4.9, nullables desde el día 1 ────────────────────────────

select col_is_null('items', 'lote_id', '`items.lote_id` es gancho VIVO y nullable (§4.9)');
select col_is_null('paradas', 'motivo_id', '`paradas.motivo_id` nace nullable: `motivos` es AC-FRUT-13');
select col_is_null('paradas', 'promesa_original',
  'la promesa nace vacía: la congela «Publicar día» (§5.2 F1)');

-- Compuesta con el tenant, como TODA FK del esquema (§4.1): una FK por id a secas dejaría
-- entrar un lote de otro tenant.
select fk_ok('items', array['tenant_id', 'lote_id'], 'lot', array['tenant_id', 'id']);

-- La FK que el módulo 00 dejó anotada para este hito («la FK a `paradas` la completa el hito d»).
select fk_ok('stop_requirement', array['tenant_id', 'parada_id'], 'paradas', array['tenant_id', 'id']);

-- ─── Los CHECKs que impiden un día imposible ────────────────────────────────────────

select throws_ok(
  $$ insert into paradas (ruta_id, tipo, orden, destino_id)
     select ruta, 'recarga', 90, compartido from r, f $$,
  '23514', null,
  'una recarga con destino confundiría el enchufe con una panadería'
);
select throws_ok(
  $$ insert into paradas (ruta_id, tipo, orden) select ruta, 'entrega', 91 from r $$,
  '23514', null,
  'una entrega sin destino no ubica nada'
);
-- Y el positivo: la recarga SIN destino entra, o el CHECK estaría prohibiendo el §5.2 F4 entero.
insert into paradas (ruta_id, tipo, orden) select ruta, 'recarga', 92 from r;
select pass('una parada de recarga sin destino entra: es un enchufe, no una dirección');

select throws_ok(
  $$ insert into paradas (ruta_id, tipo, orden, destino_id, resultado)
     select ruta, 'entrega', 93, propio, 'exito' from r, f $$,
  '23514', null,
  'una parada que no se cerró no puede traer resultado: el resultado es del terreno'
);

select throws_ok(
  $$ update rutas set version = 3 where id = (select ruta from r) $$,
  '23514', null,
  'versionada sin publicar es un día congelado a medias'
);
select throws_ok(
  $$ update rutas set publicada_en = now() where id = (select ruta from r) $$,
  '23514', null,
  'publicada sin versión: nadie sabría contra qué versión opera el chofer'
);
-- Las dos juntas sí, que es lo que hace «Publicar día».
update rutas set publicada_en = now(), version = 1 where id = (select ruta from r);
select pass('publicada Y versionada: así queda el día al publicarlo (§5.2 F1)');

select throws_ok(
  $$ update rutas set es_maestra = true where id = (select ruta from r) $$,
  '23514', null,
  'una maestra es una plantilla y no sale a la calle (§3.E1.6)'
);

-- ─── La plantilla de requisitos tiene el MISMO shape que su destino ──────────────────
--
-- Es lo que hace que derivar sea COPIAR. Si las columnas se separaran, entre la plantilla y la
-- parada aparecerían reglas de traducción — y esas reglas son los condicionales por vertical que
-- el §4.6 prohíbe con todas las letras.
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_name = 'cargo_type_requirement'
      and column_name in ('tipo_evidencia', 'obligatorio', 'orden')),
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_name = 'stop_requirement'
      and column_name in ('tipo_evidencia', 'obligatorio', 'orden')),
  'la plantilla y el requisito comparten shape: derivar es copiar, no traducir (§4.6)'
);

insert into cargo_type (codigo, nombre) values ('pan', 'Pan de molde');
select throws_ok(
  $$ insert into cargo_type_requirement (cargo_type_id, tipo_evidencia, obligatorio, orden)
     select id, 'firma', true, 1 from cargo_type where codigo = 'pan';
     insert into cargo_type_requirement (cargo_type_id, tipo_evidencia, obligatorio, orden)
     select id, 'firma', true, 2 from cargo_type where codigo = 'pan' $$,
  '23505', null,
  'dos veces la misma evidencia en el mismo tipo de carga: el operario firmaría dos veces lo mismo'
);
