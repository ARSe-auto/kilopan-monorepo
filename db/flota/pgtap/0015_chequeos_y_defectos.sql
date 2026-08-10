-- pgTAP: la cadena chequeo → defecto → resolución, y de dónde sale «apto». [AC-FVEH-04]
--
-- Acá va lo que solo la base sostiene: que un chequeo sea append-only, que un defecto no pueda
-- cambiar de chequeo, que resolver exija nota, y —lo más importante— que «apto» derive del
-- ÚLTIMO chequeo FIRMADO y de nada más (§4.5). El 2xx del sync, el replay doble y el «no
-- bloquea la apertura» viven en `apps/flota/e2e/chequeos.spec.ts`.

select no_plan();

select has_table('chequeos');
select has_table('defectos');

select matches(
  obj_description('chequeos'::regclass, 'pg_class'),
  '^CAPTURA',
  'chequeos: declara su clase CAPTURA (§4.2) — jamás rebota al sincronizar'
);

-- Idempotencia del replay (centinela 1 §9.3): el segundo envío no crea una segunda fila.
select col_is_unique('chequeos', array['tenant_id', 'client_uuid']);

-- ─── El fixture ──────────────────────────────────────────────────────────────────────

insert into vehiculos (patente, tipo) values ('CHQ0001', 'furgón');

-- Quien firma. El canario nace vacío, así que la persona y su aparato se crean acá. El RUT
-- sale de la lista congelada de fixtures (AC-FIDN-21): cero datos personales reales (§7.8).
insert into personas (rut, nombre) values ('11.111.111-1', 'Quien chequea');
insert into usuarios (persona_id, rol)
  select id, 'chofer' from personas where rut = '11.111.111-1';
insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
  select 'personal', p.id, 'hash-del-fixture-de-pgtap', u.id, now()
    from personas p join usuarios u on u.persona_id = p.id
   where p.rut = '11.111.111-1';

create temporary table c_ids as
  select (select id from vehiculos where patente = 'CHQ0001') as v,
         (select id from personas where rut = '11.111.111-1') as persona,
         (select id from dispositivos limit 1) as dispositivo;

-- Sin chequeo firmado, «apto» es NULL: nadie miró todavía. No es «apto» ni «no apto», y la
-- pantalla no puede confundirlos — decir «apto» sin haber mirado es la peor de las tres.
select is(
  (select vehiculo_apto((select v from c_ids))),
  null,
  'sin chequeo firmado, «apto» es NULL: nadie miró todavía'
);

insert into chequeos (inspectable_tipo, inspectable_id, momento, ts_dispositivo, tz_offset_min)
  select 'vehiculos', v, 'pre', now(), -240 from c_ids;

-- Un chequeo SIN FIRMAR tampoco acredita: el §4.5 dice «último chequeo FIRMADO».
select is(
  (select vehiculo_apto((select v from c_ids))),
  null,
  'un chequeo sin firmar no acredita aptitud (§4.5)'
);

-- ─── Append-only ─────────────────────────────────────────────────────────────────────

select throws_ok(
  $$ update chequeos set nota = 'editado' $$,
  '42501',
  null,
  'un chequeo no se edita: es un hecho del terreno (§4.6)'
);

-- ─── El defecto y su ciclo ───────────────────────────────────────────────────────────

insert into defectos (chequeo_id, item)
  select id, 'luz de freno' from chequeos limit 1;

-- Resolver SIN nota rebota: un defecto que se cierra sin decir cómo vuelve a aparecer y nadie
-- sabe qué se probó la vez anterior (misma regla que `review_queue`, §5.6).
select throws_ok(
  $$ update defectos set estado = 'resuelto', resuelto_en = now() $$,
  '23514',
  null,
  'cerrar un defecto sin nota rebota: sin ella vuelve a aparecer y nadie sabe qué se probó'
);

-- Y un defecto no cambia de chequeo: su origen es parte de lo que prueba (§4.5). El segundo
-- chequeo existe solo para tener a dónde intentar moverlo.
insert into chequeos (inspectable_tipo, inspectable_id, momento, ts_dispositivo, tz_offset_min)
  select 'vehiculos', v, 'post', now() + interval '1 minute', -240 from c_ids;

select throws_ok(
  $$ update defectos
        set chequeo_id = (select id from chequeos where momento = 'post' order by record_time desc limit 1)
      where chequeo_id <> (select id from chequeos where momento = 'post' order by record_time desc limit 1) $$,
  '23514',
  null,
  'un defecto no se reasigna a otro chequeo: rompería la cadena del §4.5'
);

-- ─── «Apto» deriva del último chequeo FIRMADO ────────────────────────────────────────
--
-- La firma y el chequeo nacen JUNTOS, y el fixture lo hace como lo hace el servidor: se genera
-- el id del chequeo primero, la firma lo referencia, y el chequeo entra ya firmado. No se puede
-- «firmar después» con un UPDATE — `chequeos` es append-only (§4.6) y el test de más arriba lo
-- verifica. Eso es una restricción de diseño y no un estorbo del fixture: un chequeo que se
-- pudiera firmar más tarde permitiría acreditar hoy lo que alguien miró la semana pasada.

create temporary table firmado as
  select uuidv7() as chequeo_viejo, uuidv7() as chequeo_nuevo;

insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado)
  select persona, dispositivo, 'chequeos', (select chequeo_viejo from firmado),
         -- `verifico` es el significado que corresponde a un chequeo: quien firma no recibió ni
         -- liberó carga, verificó el estado del vehículo (§4.3, enum cerrado de significados).
         'verifico'
    from c_ids;

insert into chequeos (id, inspectable_tipo, inspectable_id, momento, firma_id, ts_dispositivo, tz_offset_min)
  select (select chequeo_viejo from firmado), 'vehiculos', v, 'pre',
         (select id from firmas order by ts_servidor desc limit 1),
         now() + interval '2 minutes', -240
    from c_ids;

insert into defectos (chequeo_id, item)
  select chequeo_viejo, 'luz de freno' from firmado;

-- Con el chequeo firmado y su defecto NO bloqueante: apto. Un ítem fallado por sí solo no
-- detiene nada (§7.6) — si lo hiciera, la persona aprendería a no marcar nada.
select is(
  (select vehiculo_apto((select v from c_ids))),
  true,
  'un defecto NO bloqueante no deja al vehículo fuera de servicio (§7.6)'
);

-- El operador lo marca bloqueante: recién ahí deja de estar apto.
update defectos set bloqueante = true where chequeo_id = (select chequeo_viejo from firmado);
select is(
  (select vehiculo_apto((select v from c_ids))),
  false,
  'un defecto BLOQUEANTE sin resolver sí lo deja fuera de servicio'
);

-- Y resolverlo, con su nota, lo devuelve a servicio.
update defectos set estado = 'resuelto', resuelto_en = now(), nota = 'se cambió la ampolleta'
 where chequeo_id = (select chequeo_viejo from firmado);
select is(
  (select vehiculo_apto((select v from c_ids))),
  true,
  'resolver el bloqueante devuelve el vehículo a servicio'
);

-- Un chequeo firmado MÁS NUEVO manda sobre el viejo: «apto» mira el último y no la suma de
-- todos. Sin esto, un defecto de hace un mes dejaría el camión detenido para siempre.
insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado)
  select persona, dispositivo, 'chequeos', (select chequeo_nuevo from firmado), 'verifico'
    from c_ids;

insert into chequeos (id, inspectable_tipo, inspectable_id, momento, firma_id, ts_dispositivo, tz_offset_min)
  select (select chequeo_nuevo from firmado), 'vehiculos', v, 'post',
         (select id from firmas order by ts_servidor desc, id desc limit 1),
         now() + interval '3 minutes', -240
    from c_ids;

insert into defectos (chequeo_id, item, bloqueante)
  select chequeo_nuevo, 'espejo roto', true from firmado;

select is(
  (select vehiculo_apto((select v from c_ids))),
  false,
  'manda el ÚLTIMO chequeo firmado: su bloqueante nuevo deja el vehículo fuera'
);

select finish();
