-- pgTAP: `entregas_pod` write-once, y el supersede como ÚNICA corrección. [AC-FPOD-11]
--
-- Fuente: §4.5 (`UNIQUE(encargo) WHERE cerrada AND supersede IS NULL`) · §4.2 (clase CAPTURA)
-- · §7.4 (append-only, corrección con motivo y autor) · §9.3.6 (centinela 6).
--
-- Acá se prueba lo que es del ESQUEMA: la forma de la tabla y las reglas que ninguna ruta HTTP
-- puede saltarse. El rebote 42501 visto por el ROL DE APP real —la otra mitad del centinela 6,
-- que el REVOKE cubre y este trigger no distingue— vive en `db/flota/suite-bd/pod-inmutable.
-- test.mjs`, porque pgTAP corre con el rol migrador y probarlo acá sería probar el rol
-- equivocado.

select no_plan();

-- ─── La forma: lo que el §4.5 y el §4.2 exigen del catálogo ──────────────────────────────

select has_table('entregas_pod',
  'la fila donde aterriza el POD nace en el módulo 04, no en el lote transversal del §4.6');
select has_column('entregas_pod', 'encargo_id', 'el encargo es el sujeto de la unicidad (§4.5)');
select has_column('entregas_pod', 'cerrada', 'sin `cerrada` el índice del §4.5 no puede ser parcial');
select has_column('entregas_pod', 'supersede_id', 'la corrección del §7.4 necesita a quién apunta');
select col_not_null('entregas_pod', 'tenant_id', 'toda tabla de dominio lleva su tenant (§4.1)');
select col_not_null('entregas_pod', 'event_time', 'el doble reloj del §4.6 no es opcional');
select col_not_null('entregas_pod', 'tz_offset_min',
  'un event_time sin huso convierte una captura de anteayer en una de hoy (§4.6)');

-- La clase de la regla de oro (§4.2). Es lo que decide si esta tabla puede rebotar al
-- sincronizar: CAPTURA jamás rebota.
select matches(
  obj_description('entregas_pod'::regclass, 'pg_class'),
  '^CAPTURA —',
  'el POD es CAPTURA: entra siempre y se degrada a flag, jamás rebota al sincronizar (§4.2)'
);

-- El índice del §4.5, verificado por su DEFINICIÓN y no solo por su nombre: un índice único
-- sin el `where` sería otra regla —prohibiría las correcciones— con el mismo nombre.
select matches(
  (select indexdef from pg_indexes where indexname = 'entregas_pod_una_vigente_por_encargo'),
  'UNIQUE.*\(tenant_id, encargo_id\).*WHERE.*cerrada.*supersede_id IS NULL',
  'el write-once es UNIQUE(encargo) WHERE cerrada AND supersede IS NULL, literal (§4.5)'
);

-- ─── El fixture: un encargo con su parada de entrega ─────────────────────────────────────
--
-- El RUT sale de la lista congelada de `db/flota/ruts-sinteticos.mjs` (§7.8, §10): es la misma
-- empresa contratante de los fixtures del módulo 03, que es de donde vienen los encargos.

insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
insert into destinos (nombre) values ('Almacén de la esquina');
insert into motivos (codigo, etiqueta, estado_asociado)
  values ('local_cerrado', 'Local cerrado', 'no_entregado');

insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
  select (select id from empresas_cliente limit 1), (select id from destinos limit 1), 8, 'solicitado';

insert into rutas (nombre) values ('Ruta del gate');
insert into paradas (ruta_id, tipo, orden, destino_id)
  select (select id from rutas limit 1), 'entrega', 1, (select id from destinos limit 1);

-- `actor_id` es un identificador opaco sin FK, igual que en `eventos`: el plano de identidad
-- no se ata a los hechos (§7.8). Un literal alcanza y no obliga a sembrar una persona.
create temporary table f as
  select (select id from encargos limit 1)                        as encargo,
         (select id from paradas limit 1)                         as parada,
         (select id from motivos where codigo = 'local_cerrado')  as motivo,
         '019fe000-0000-7000-8000-0000000000ac'::uuid             as actor;

-- ─── Write-once: una sola entrega vigente por encargo ────────────────────────────────────

select lives_ok(
  $$ insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
       select encargo, parada, 'exito', now(), -240 from f $$,
  'el POD del camino feliz entra'
);

select throws_ok(
  $$ insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
       select encargo, parada, 'exito', now(), -240 from f $$,
  '23505',
  null,
  'un SEGUNDO POD cerrado para el mismo encargo rebota: la entrega ya está declarada (§4.5)'
);

-- Y la mitad que hace parcial al índice: una captura que todavía no cierra la parada no
-- compite por la unicidad. Sin esta prueba, un UNIQUE a secas pasaría los asertos de arriba.
select lives_ok(
  $$ insert into entregas_pod (encargo_id, parada_id, resultado, cerrada, event_time, tz_offset_min)
       select encargo, parada, 'parcial', false, now(), -240 from f $$,
  'una captura que no cierra la parada convive con la vigente: el índice es PARCIAL'
);

-- La idempotencia del §0: el replay del outbox reintenta el mismo hecho hasta que el servidor
-- confirma, y sin esta llave cada reintento sería una entrega más.
select throws_ok(
  $$ insert into entregas_pod (encargo_id, parada_id, resultado, cerrada, client_uuid,
                               event_time, tz_offset_min)
       select encargo, parada, 'parcial'::parada_resultado, false,
              '019fe000-0000-7000-8000-0000000000aa'::uuid, now(), -240 from f
     union all
     select encargo, parada, 'parcial'::parada_resultado, false,
              '019fe000-0000-7000-8000-0000000000aa'::uuid, now(), -240 from f $$,
  '23505',
  null,
  'el mismo `client_uuid` dos veces rebota: el replay no duplica la entrega (§0)'
);

-- ─── La corrección es un supersede con motivo y autor, jamás un UPDATE (§7.4) ────────────

select throws_ok(
  $$ update entregas_pod set resultado = 'fallo' where cerrada $$,
  '42501',
  null,
  'editar un POD rebota con 42501 hasta para el migrador: el append-only es del esquema (§7.4)'
);
select throws_ok(
  $$ delete from entregas_pod $$,
  '42501',
  null,
  'un POD jamás se borra: es la evidencia de la que nace la liquidación (§7.4)'
);
select throws_ok(
  $$ truncate entregas_pod $$,
  '42501',
  null,
  'el TRUNCATE es el borrado que el trigger FOR EACH ROW dejaría pasar'
);

select throws_ok(
  $$ insert into entregas_pod (encargo_id, parada_id, resultado, supersede_id,
                               event_time, tz_offset_min)
       select f.encargo, f.parada, 'fallo', p.id, now(), -240
         from f, entregas_pod p where p.cerrada $$,
  '23514',
  null,
  'una corrección sin motivo ni autor es indistinguible de una adulteración (§7.4)'
);

select lives_ok(
  $$ insert into entregas_pod (encargo_id, parada_id, resultado, motivo_id, supersede_id,
                               supersede_motivo, actor_id, event_time, tz_offset_min)
       select f.encargo, f.parada, 'fallo', f.motivo, p.id,
              'el receptor no era quien firmó', f.actor, now(), -240
         from f, entregas_pod p where p.cerrada $$,
  'con motivo y autor, la corrección entra — y es una fila NUEVA'
);

-- Centinela 6, la mitad que importa: la corrección NO reemplazó nada. Quedan DOS filas para
-- ese encargo y la original sigue diciendo `exito`.
select is(
  (select count(*) from entregas_pod p, f
    where p.encargo_id = f.encargo and (p.cerrada or p.supersede_id is not null)),
  2::bigint,
  'supersede ⇒ 2 filas: la original y la que la corrige (centinela 6, §9.3.6)'
);
select is(
  (select p.resultado::text from entregas_pod p
    where p.cerrada and p.supersede_id is null),
  'exito',
  'la original quedó INTACTA: la corrección no reescribió la historia (centinela 6)'
);
select is(
  (select count(*) from entregas_pod where supersede_id is not null),
  1::bigint,
  'y la corrección apunta a la fila que corrige, no vive suelta'
);

-- Una fila que se supersede a sí misma sería una cadena de corrección sin fin.
select throws_ok(
  $$ insert into entregas_pod (id, encargo_id, parada_id, resultado, supersede_id,
                               supersede_motivo, actor_id, event_time, tz_offset_min)
       select '019fe000-0000-7000-8000-0000000000bb', encargo, parada, 'fallo',
              '019fe000-0000-7000-8000-0000000000bb', 'circular', actor, now(), -240
         from f $$,
  '23514',
  null,
  'un POD no se corrige a sí mismo'
);

-- ─── Y el tenant, que es la constante de la BD (§4.1) ────────────────────────────────────

select is(
  (select count(distinct tenant_id) from entregas_pod),
  1::bigint,
  'el DEFAULT horneó la constante de la BD en cada fila'
);
select throws_ok(
  $$ insert into entregas_pod (tenant_id, encargo_id, parada_id, resultado, cerrada,
                               event_time, tz_offset_min)
       select '019fe000-0000-7000-8000-000000000000', encargo, parada, 'exito', false, now(), -240
         from f $$,
  '23514',
  null,
  'un POD de otro tenant no entra a la BD de este (§4.1)'
);

select finish();
