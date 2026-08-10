-- 0037 — `rutas`, `paradas` e `items`: la agrupación multi-empresa. [AC-FRUT-04]
--
-- La columna vertebral del módulo 03. Hasta acá la bandeja acumulaba encargos sueltos; desde
-- acá el día tiene forma: una ruta por vehículo, paradas en orden, e ítems que dicen cuánto de
-- cada empresa va en cada parada.
--
-- ─── LA AGRUPACIÓN LA GARANTIZA LA BASE, NO EL SERVIDOR ────────────────────────────
--
-- El §3.E1.5 pide que N encargos de ≥2 empresas al MISMO destino produzcan UNA sola parada de
-- entrega. Eso podría escribirse como un `group by` en el servidor y confiar en que nadie
-- inserte por otro camino — pero el día que un import, un backfill o un flujo nuevo cree la
-- segunda parada, el camión hace dos veces la misma cuadra y nadie se entera hasta que el
-- chofer llama. El índice único parcial `paradas_una_entrega_por_destino` lo vuelve imposible:
-- la agrupación es un invariante de la BD, y el servidor solo tiene que respetarla.
--
-- Va PARCIAL (`where tipo = 'entrega'`) porque las de `carga` sí se repiten —una ruta pasa dos
-- veces por la panadería si hay dos turnos de horno— y las de `recarga` ni siquiera tienen
-- destino.
--
-- ─── EL DESGLOSE POR EMPRESA VIVE EN `items`, Y CON SU PROPIA COLUMNA ──────────────
--
-- «Una parada cuyos ítems conservan el desglose por empresa»: el ítem apunta a su encargo, y el
-- encargo a su empresa. `items.empresa_cliente_id` podría entonces deducirse con un join. Va
-- igual como columna por dos razones que no son de comodidad:
--
--   · el rol `cliente` queda confinado a SU empresa por política de BD (§7.2, §9.3.3, AC-FRUT-12)
--     y una política que tiene que salir a buscar la empresa por un join es una política que se
--     puede dejar sin efecto cambiando el join;
--   · el sub-manifiesto de F2 es POR EMPRESA (§5.2 F2) y se arma en el andén, con el aparato
--     que hay: que sea un `group by` sobre una columna de la propia tabla es la diferencia
--     entre una pantalla y una consulta que se cae.
--
-- El trigger `items_empresa_del_encargo` la mantiene fiel al encargo: no es un dato que alguien
-- pueda escribir distinto.
--
-- ─── `motivo_id` NACE SIN SU FK, Y ESTÁ DICHO ─────────────────────────────────────
--
-- `motivos` es AC-FRUT-13 y todavía no existe. La columna nace igual —nullable y VIVA desde el
-- día 1, como manda el §4.9 para los ganchos— y su FK la agrega ese AC. Lo mismo `lote_id`,
-- cuya tabla sí existe (`lot`, del módulo 00) y por eso ya lleva su FK puesta.

create type ruta_origen as enum ('maestra', 'optimizada', 'manual');
create type parada_tipo as enum ('carga', 'entrega', 'recarga');
create type parada_estado as enum ('pending', 'en_camino', 'llegada', 'done', 'cancelled');
create type parada_resultado as enum ('exito', 'fallo', 'parcial');

comment on type ruta_origen is
  'El §4.5, literal. `optimizada` existe en el enum pero NINGÚN flujo de E1 la produce: la '
  'genera el VRP en E2 (§3.E1.6). Agregarle un valor después sería un ALTER TYPE en producción.';

create table rutas (
  id                     uuid        not null default uuidv7(),
  tenant_id              uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  nombre                 text,
  vehiculo_id            uuid,
  fecha_servicio         date        not null default (now() at time zone 'America/Santiago')::date,
  origen                 ruta_origen not null default 'manual',
  -- La ruta maestra de la que nació, si nació de una (§3.E1.6, AC-FRUT-06). Autorreferencia:
  -- una maestra es una ruta como cualquier otra, con `es_maestra`.
  maestra_id             uuid,
  es_maestra             boolean     not null default false,
  -- 0 mientras es borrador. «Publicar día» la fija (§5.2 F1) — la conducta es AC-FRUT-05.
  version                int         not null default 0,
  publicada_en           timestamptz,
  km_estimados           numeric(8, 2),
  min_estimados          int,
  -- Lo que el módulo 02 espera para poder decir «alcanza» o «no alcanza» (§4.5): sin un
  -- necesario contra el que comparar, el semáforo del tablero solo puede decir qué falta.
  km_presupuesto_energia numeric(8, 2),
  client_uuid            uuid,
  creada_en              timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, vehiculo_id) references vehiculos (tenant_id, id),
  foreign key (tenant_id, maestra_id) references rutas (tenant_id, id),
  constraint rutas_version_no_negativa check (version >= 0),
  -- Publicada y sin versión, o versionada y sin publicar, son dos formas de la misma
  -- inconsistencia: el día quedaría congelado a medias y nadie sabría contra qué opera.
  constraint rutas_publicada_con_version check ((publicada_en is null) = (version = 0)),
  -- Una maestra es una plantilla: no se publica ni sale a la calle (§3.E1.6).
  constraint rutas_maestra_no_se_publica check (not (es_maestra and publicada_en is not null))
);
create index rutas_tenant_fecha_idx on rutas (tenant_id, fecha_servicio desc);
create index rutas_tenant_vehiculo_idx on rutas (tenant_id, vehiculo_id, fecha_servicio desc);
create index rutas_tenant_maestra_idx on rutas (tenant_id, maestra_id);

comment on table rutas is
  'PLANIFICACIÓN — el día de un vehículo (§4.5, §5.2 F1). Se arma con red y antes de que el '
  'camión exista: acá SÍ se rebota 422 con 0 filas (§4.2).';

create table paradas (
  id               uuid             not null default uuidv7(),
  tenant_id        uuid             not null default tenant_actual() check (tenant_id = tenant_actual()),
  ruta_id          uuid             not null,
  tipo             parada_tipo      not null,
  orden            int              not null,
  -- Nullable porque una parada de `recarga` no va a un destino: va a un enchufe (§5.2 F4).
  destino_id       uuid,
  ventana          tstzrange,
  -- CONGELADA al publicar y APARTE del ETA vivo (§4.5). Son dos cosas distintas a propósito:
  -- la promesa es lo que se le dijo al cliente y no cambia; el ETA se mueve todo el día. Con
  -- una sola columna, la primera demora reescribiría la promesa y nadie podría decir si se
  -- cumplió.
  promesa_original tstzrange,
  eta              timestamptz,
  -- El estado VISIBLE es proyección de eventos (§4.6) y las transiciones de terreno las
  -- escribe el módulo 04. Acá nace `pending` y la planificación no lo mueve.
  estado           parada_estado    not null default 'pending',
  resultado        parada_resultado,
  -- Sin FK todavía: `motivos` es AC-FRUT-13. Nullable y VIVA desde el día 1 (§4.9).
  motivo_id        uuid,
  metodo_entrega   text,
  -- El bloque de agenda tipo `recarga` que la originó, si la originó uno (§5.2 F4, AC-FRUT-18).
  bloque_agenda_id uuid,
  client_uuid      uuid,
  creada_en        timestamptz      not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  unique (tenant_id, ruta_id, orden),
  foreign key (tenant_id, ruta_id) references rutas (tenant_id, id) on delete cascade,
  foreign key (tenant_id, destino_id) references destinos (tenant_id, id),
  foreign key (tenant_id, bloque_agenda_id) references bloques_agenda (tenant_id, id),
  constraint paradas_orden_positivo check (orden > 0),
  -- Una entrega sin destino no ubica nada; una recarga con destino confunde el enchufe con
  -- una panadería. La carga sí lo lleva: es de dónde se retira.
  constraint paradas_destino_segun_tipo check (
    (tipo = 'recarga' and destino_id is null) or (tipo <> 'recarga' and destino_id is not null)
  ),
  -- El resultado es del terreno: una parada que todavía no se cerró no puede tenerlo.
  constraint paradas_resultado_solo_al_cerrar check (
    resultado is null or estado in ('done', 'cancelled')
  )
);
create index paradas_tenant_ruta_idx on paradas (tenant_id, ruta_id, orden);
create index paradas_tenant_destino_idx on paradas (tenant_id, destino_id);
-- Encabeza la FK a `bloques_agenda`: sin él, borrar un bloque de la agenda haría scan completo
-- de las paradas de todos los días (§9.2).
create index paradas_tenant_bloque_idx on paradas (tenant_id, bloque_agenda_id);

-- EL invariante del AC: una sola parada de entrega por destino en cada ruta (§3.E1.5). Va en la
-- BD y no en el servidor porque un `group by` lo respeta hasta que alguien inserte por otro
-- camino, y el costo de ese día es un camión haciendo dos veces la misma cuadra.
create unique index paradas_una_entrega_por_destino
  on paradas (tenant_id, ruta_id, destino_id)
  where tipo = 'entrega';

comment on table paradas is
  'PLANIFICACIÓN — cada punto del día, en orden (§4.5). UNA sola de tipo `entrega` por destino '
  'en cada ruta, garantizado por índice único parcial: los encargos de N empresas al mismo '
  'destino se agrupan en ella y el desglose lo conservan sus `items` (§3.E1.5).';

comment on column paradas.promesa_original is
  'Congelada al publicar el día y APARTE del ETA vivo (§4.5, §5.2 F1). Es lo que se le prometió '
  'al cliente: si se moviera con cada demora, nadie podría decir si se cumplió.';

create table items (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  parada_id          uuid        not null,
  encargo_id         uuid        not null,
  -- El desglose por empresa, en columna propia: la política del rol `cliente` (§7.2) no puede
  -- depender de un join, y el sub-manifiesto por empresa del andén (§5.2 F2) es un `group by`
  -- sobre esta columna. La mantiene fiel el trigger, no quien inserta.
  empresa_cliente_id uuid        not null,
  qty_planificada    int         not null,
  -- Las captura el módulo 04 desde el terreno: nacen NULL y NULL no es cero. Un cero acá diría
  -- «se entregaron cero» sobre una parada que todavía no se visitó.
  qty_entregada      int,
  qty_rechazada      int,
  motivo_item        uuid,
  uom                text        not null default 'bulto',
  -- Gancho `lot` del §4.9: nullable y VIVA desde el día 1. En E1 ningún flujo la escribe.
  lote_id            uuid,
  client_uuid        uuid,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  -- Un encargo entra una sola vez en cada parada: dos filas serían el doble de bultos.
  unique (tenant_id, parada_id, encargo_id),
  foreign key (tenant_id, parada_id) references paradas (tenant_id, id) on delete cascade,
  foreign key (tenant_id, encargo_id) references encargos (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  foreign key (tenant_id, lote_id) references lot (tenant_id, id),
  constraint items_qty_planificada_positiva check (qty_planificada > 0),
  constraint items_qty_entregada_no_negativa check (qty_entregada is null or qty_entregada >= 0),
  constraint items_qty_rechazada_no_negativa check (qty_rechazada is null or qty_rechazada >= 0)
);
create index items_tenant_parada_idx on items (tenant_id, parada_id);
create index items_tenant_encargo_idx on items (tenant_id, encargo_id);
create index items_tenant_empresa_idx on items (tenant_id, empresa_cliente_id);
-- Encabeza la FK al gancho `lot`, que hoy nadie puebla: el índice va igual porque el día que
-- alguien borre un lote no puede escanear los ítems de la historia entera (§9.2).
create index items_tenant_lote_idx on items (tenant_id, lote_id);

comment on table items is
  'PLANIFICACIÓN — qué va en cada parada y de qué empresa (§4.5). La entrega parcial es de '
  'primera clase POR ÍTEM (§3.E1.5): `qty_entregada`/`qty_rechazada` nacen NULL y las captura '
  'el módulo 04 desde el terreno.';

comment on column items.empresa_cliente_id is
  'El desglose por empresa de una parada agrupada (§3.E1.5). Columna propia y no un join: la '
  'política del rol `cliente` (§7.2) se apoya en ella y el sub-manifiesto de F2 la agrupa.';

/**
 * La empresa del ítem es LA DEL ENCARGO, siempre.
 *
 * Sin esto, `empresa_cliente_id` sería un dato que alguien puede escribir distinto — y un ítem
 * atribuido a la empresa equivocada es carga que aparece en el sub-manifiesto de otro y una
 * ecuación de cierre que cuadra por casualidad. Se estampa en vez de validarse porque quien
 * inserta un ítem ya dijo de qué encargo es: pedirle el dato dos veces es pedirle que se
 * equivoque una.
 */
create or replace function item_empresa_del_encargo() returns trigger
  language plpgsql as $$
  declare
    del_encargo uuid;
  begin
    select empresa_cliente_id into del_encargo from encargos where id = new.encargo_id;
    if del_encargo is null then
      raise exception 'el ítem apunta a un encargo que no existe'
        using errcode = 'foreign_key_violation';
    end if;
    new.empresa_cliente_id := del_encargo;
    return new;
  end;
  $$;

create trigger items_empresa_del_encargo
  before insert or update on items
  for each row execute function item_empresa_del_encargo();

-- --- La plantilla de la que se derivan los requisitos de evidencia ------------------------
--
-- El §4.6 dice que `stop_requirement` se deriva DEL CARGO_TYPE, y el §4.9 que un vertical nuevo
-- son FILAS y jamás una migración. Para que las dos cosas sean ciertas a la vez, el cargo_type
-- tiene que llevar la lista de evidencias que pide — y hoy `cargo_type` es (codigo, nombre).
--
-- Esta tabla es esa lista, con el MISMO shape que `stop_requirement` menos la parada. Que sea
-- el mismo shape es lo que hace que «derivar» sea copiar: si la plantilla tuviera una forma
-- distinta, entre ella y la parada habría reglas de traducción — y esas reglas son exactamente
-- los condicionales por vertical que el §4.6 prohíbe con todas las letras.
--
-- **Pregunta al dueño (spec 03, nueva):** de dónde se SIEMBRA esta plantilla. `vertical_template`
-- trae hoy `cargo_types text[]` —una lista plana de códigos, sin evidencias— y el maestro no
-- dice si la lista de requisitos es otra columna suya o un catálogo que el tenant administra.
-- Mientras no haya respuesta, la tabla existe y se puebla por fila: nada acá decide por él.

create table cargo_type_requirement (
  id             uuid           not null default uuidv7(),
  tenant_id      uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  cargo_type_id  uuid           not null,
  tipo_evidencia evidencia_tipo not null,
  obligatorio    boolean        not null default true,
  orden          int            not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, cargo_type_id, orden),
  -- Dos veces la misma evidencia en el mismo tipo de carga es pedirle al operario que firme dos
  -- veces lo mismo, y en el andén eso se resuelve firmando cualquier cosa.
  unique (tenant_id, cargo_type_id, tipo_evidencia),
  foreign key (tenant_id, cargo_type_id) references cargo_type (tenant_id, id),
  constraint cargo_type_requirement_orden_positivo check (orden > 0)
);
create index cargo_type_requirement_tenant_tipo_idx
  on cargo_type_requirement (tenant_id, cargo_type_id, orden);

comment on table cargo_type_requirement is
  'PLANIFICACIÓN — qué evidencia pide cada tipo de carga (§4.6, §4.9). Es la plantilla desde la '
  'que se COPIAN los `stop_requirement` de cada parada al publicar el día: mismo shape para que '
  'derivar sea copiar y no traducir con condicionales por vertical.';

-- La FK que el módulo 00 dejó anotada para este hito: «La FK a `paradas` la completa el hito d»
-- (0006_ganchos_vivos.sql). Ya hay a qué apuntar.
alter table stop_requirement
  add constraint stop_requirement_parada_fk
  foreign key (tenant_id, parada_id) references paradas (tenant_id, id) on delete cascade;

insert into evento_tipo (codigo, descripcion) values
  ('ruta.creada',      'Se creó una ruta para armar el día de un vehículo'),
  ('ruta.publicada',   'Se publicó el día: la ruta quedó congelada y con sus requisitos derivados'),
  ('encargo.asignado', 'Un encargo se asignó a una parada de una ruta');
