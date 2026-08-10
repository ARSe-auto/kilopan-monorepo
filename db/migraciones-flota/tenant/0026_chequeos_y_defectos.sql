-- 0026 — Chequeos pre/post y el ciclo del defecto. [AC-FVEH-04]
--
-- El §4.5 los pide así: «**chequeos** sobre `inspectable` polimórfico + **defectos** con ciclo
-- propio (apto deriva del último chequeo firmado)», y el §6 nombra el patrón: Fleetio, cadena
-- chequeo → defecto → issue → resolución.
--
-- ─── OK-POR-DEFECTO, Y POR QUÉ ESO CAMBIA EL ESQUEMA ────────────────────────────────
--
-- El §5.2-F3 dice «solo se toca lo malo». La consecuencia no es de interfaz sino de datos: lo
-- que se guarda son los ítems FALLADOS, no una respuesta por cada ítem. Guardar veinte «ok»
-- por chequeo para poder guardar el único «malo» convierte una jornada en cuatrocientas filas
-- que nadie lee, y hace que agregar un ítem al checklist cambie el tamaño de la historia hacia
-- atrás. Un chequeo sin defectos ES la fila del chequeo, y con eso alcanza.
--
-- ─── UN CHEQUEO ES CAPTURA. NUNCA REBOTA ───────────────────────────────────────────
--
-- Append-only (§4.6) e idempotente por `client_uuid` (centinela 1): el replay del outbox no
-- crea una segunda fila. Un ítem fallado no bloquea la apertura del turno (§7.6) — lo que hace
-- es dejar el defecto escrito. El `bloqueante` de verdad lo marca el OPERADOR después, con red,
-- y por eso es una columna del defecto y no del ítem: la decisión de detener un camión no la
-- toma un formulario a las cinco de la mañana.
--
-- ─── EL INSPECTABLE ES POLIMÓRFICO, PERO NO LIBRE ──────────────────────────────────
--
-- En E1 se inspecciona un vehículo. `instrument` queda como gancho del §4.9 y por eso la
-- columna lleva el TIPO además del id: cuando el gancho se encienda no hay que migrar nada.
-- No hay FK —no se puede referenciar dos tablas desde una columna— y sí hay un CHECK sobre el
-- tipo, para que «vehiculos» no conviva con «vehiculo» y «Vehiculos» en la misma tabla.

create type chequeo_momento as enum ('pre', 'post');
create type defecto_estado as enum ('abierto', 'en_curso', 'resuelto');

create table chequeos (
  id               uuid            not null default uuidv7(),
  tenant_id        uuid            not null default tenant_actual() check (tenant_id = tenant_actual()),
  inspectable_tipo text            not null,
  inspectable_id   uuid            not null,
  momento          chequeo_momento not null,
  turno_id         uuid,
  -- La firma por PIN del §4.3. NULL mientras no se firme: «apto» deriva del último chequeo
  -- FIRMADO (§4.5), así que un chequeo sin firma existe pero no acredita nada.
  firma_id         uuid,
  nota             text,
  ts_dispositivo   timestamptz     not null,
  tz_offset_min    int             not null,
  record_time      timestamptz     not null default now(),
  client_uuid      uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Centinela 1: el replay del outbox no crea una segunda fila (§0, §4.7).
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, turno_id) references turnos (tenant_id, id),
  foreign key (tenant_id, firma_id) references firmas (tenant_id, id),
  constraint chequeos_inspectable_conocido
    check (inspectable_tipo in ('vehiculos', 'instrument'))
);
create index chequeos_tenant_inspectable_idx
  on chequeos (tenant_id, inspectable_tipo, inspectable_id, record_time desc);
create index chequeos_tenant_turno_idx on chequeos (tenant_id, turno_id);
create index chequeos_tenant_firma_idx on chequeos (tenant_id, firma_id);

comment on table chequeos is
  'CAPTURA — chequeo pre/post sobre un inspectable (§4.5, §5.2-F3/F5). Jamás rebota al '
  'sincronizar; un ítem fallado no bloquea la apertura (§7.6). OK-por-defecto: lo que se '
  'guarda son los DEFECTOS, no una respuesta por cada ítem.';

create trigger chequeos_append_only
  before update or delete on chequeos
  for each row execute function rechazar_mutacion_de_hecho();
create trigger chequeos_append_only_truncate
  before truncate on chequeos
  for each statement execute function rechazar_mutacion_de_hecho();

-- ─── El defecto y su ciclo ───────────────────────────────────────────────────────────
--
-- `defectos` NO es append-only, y es la única tabla de esta migración que no lo es: su razón
-- de existir es CAMBIAR de estado — abierto, en curso, resuelto (§6, patrón Fleetio). Lo que
-- no cambia es de dónde vino: `chequeo_id` es inmutable por trigger, porque un defecto que
-- pudiera reasignarse a otro chequeo rompería la cadena que el §4.5 pide.
create table defectos (
  id           uuid           not null default uuidv7(),
  tenant_id    uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  chequeo_id   uuid           not null,
  item         text           not null,
  -- El `bloqueante` REAL lo marca el operador con red (§5.2-F3, §7.6). Nace en falso: la
  -- decisión de detener un camión no la toma un formulario a las cinco de la mañana.
  bloqueante   boolean        not null default false,
  estado       defecto_estado not null default 'abierto',
  nota         text,
  abierto_en   timestamptz    not null default now(),
  resuelto_en  timestamptz,
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, chequeo_id) references chequeos (tenant_id, id),
  constraint defectos_item_no_vacio check (length(btrim(item)) > 0),
  -- Resuelto exige fecha Y nota: un defecto que se cierra sin decir cómo es un defecto que
  -- vuelve a aparecer sin que nadie sepa qué se probó la vez anterior (§5.6, misma regla que
  -- `review_queue`).
  constraint defectos_resuelto_con_nota
    check (estado <> 'resuelto' or (resuelto_en is not null and nota is not null))
);
create index defectos_tenant_chequeo_idx on defectos (tenant_id, chequeo_id);
create index defectos_tenant_estado_idx on defectos (tenant_id, estado, abierto_en);

comment on table defectos is
  'CAPTURA — lo que el chequeo encontró mal (§4.5, §6). Nace del chequeo y cambia de estado: '
  'abierto → en curso → resuelto. `bloqueante` lo marca el OPERADOR, jamás el formulario.';

create trigger defectos_auditar
  after insert or update or delete on defectos
  for each row execute function auditar();

/** El origen de un defecto no se reasigna: rompería la cadena chequeo → defecto del §4.5. */
create or replace function defecto_conserva_su_origen() returns trigger
  language plpgsql as $$
  begin
    if new.chequeo_id is distinct from old.chequeo_id then
      raise exception
        'un defecto no cambia de chequeo (§4.5): su origen es parte de lo que prueba'
        using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

create trigger defectos_conservan_su_origen
  before update on defectos
  for each row execute function defecto_conserva_su_origen();

/**
 * ¿Está apto este vehículo? Deriva del ÚLTIMO chequeo FIRMADO (§4.5), y de nada más.
 *
 * Las tres respuestas son distintas y ninguna se puede confundir con otra:
 *   · `null`  — nunca se le hizo un chequeo firmado. No es «apto» ni «no apto»: es que nadie
 *     miró todavía, y la pantalla tiene que decir eso y no inventar un veredicto.
 *   · `false` — su último chequeo firmado dejó un defecto BLOQUEANTE sin resolver. Bloqueante
 *     de verdad, o sea marcado por el operador: un ítem fallado por sí solo no detiene nada.
 *   · `true`  — hay chequeo firmado y no hay bloqueante vivo.
 */
create or replace function vehiculo_apto(p_vehiculo uuid) returns boolean
  language sql stable as $$
    with ultimo as (
      select id from chequeos
       where inspectable_tipo = 'vehiculos' and inspectable_id = p_vehiculo
         and firma_id is not null
       order by record_time desc, id desc
       limit 1
    )
    select case
      when not exists (select 1 from ultimo) then null
      else not exists (
        select 1 from defectos d
         where d.chequeo_id = (select id from ultimo)
           and d.bloqueante and d.estado <> 'resuelto'
      )
    end
  $$;

comment on function vehiculo_apto(uuid) is
  'Si el vehículo está apto según su ÚLTIMO chequeo FIRMADO (§4.5). NULL = nadie lo chequeó '
  'todavía, que no es lo mismo que «no apto» y la pantalla no puede confundirlos.';

insert into evento_tipo (codigo, descripcion) values
  ('chequeo.registrado',  'Se registró un chequeo pre o post de un inspectable'),
  ('chequeo.defecto',     'Un chequeo dejó un defecto abierto'),
  ('defecto.en_curso',    'Alguien tomó un defecto para resolverlo'),
  ('defecto.resuelto',    'Un defecto quedó resuelto con su nota'),
  ('defecto.bloqueante',  'El operador marcó un defecto como bloqueante');
