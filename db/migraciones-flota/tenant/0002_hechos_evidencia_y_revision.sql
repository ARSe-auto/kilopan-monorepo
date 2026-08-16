-- 0002 — DDL transversal de hechos, evidencia y revisión (§4.6). [AC-FTEN-24]
--
-- Estas tablas nacen ACÁ, en el hito (a), y no en el hito (e) donde vive el motor de sync,
-- porque los hitos (b) identidad, (c) vehículos y (d) encargos ESCRIBEN en ellas y se
-- construyen antes: la plantilla es la 4ª vida de todo cambio de esquema (§4.1) y una tabla
-- que llega tarde obliga a migrar datos que ya existen.
--
-- Lo que este archivo NO trae, a propósito: ninguna CONDUCTA. El 2xx siempre de las capturas,
-- el flag, la ingesta en lote de `client_metric`, la escritura de `evidence` del POD y las
-- transiciones de `review_queue` son de los módulos 04 y 05 (§4.2). Acá está el esquema, sus
-- enums cerrados, la clase de la regla de oro y el append-only del §7.4.
--
-- `prev_hash` NO se crea: es E3 (§4.6). `event_hash` sí existe como columna; CUÁNDO se
-- computa es la Pregunta 5 de la spec 04 y no se inventa acá.

-- APPEND-ONLY (§7.4). Dos capas, porque cada una tapa lo que la otra deja pasar: el REVOKE
-- de UPDATE/DELETE al rol `app_t_<slug>` (lo aplica `db/flota/rol-app.mjs`, derivado de este
-- mismo trigger) detiene a la aplicación, y este trigger detiene también a quien tenga más
-- privilegios — el migrador, un script de mantenimiento, un psql a mano de madrugada.
-- El SQLSTATE es el mismo por los dos caminos (42501), así que el rebote se ve igual venga
-- de donde venga.
create or replace function rechazar_mutacion_de_hecho() returns trigger
  language plpgsql as $$
  begin
    raise exception
      'la tabla % es append-only (§7.4): % está prohibido. La corrección de un hecho es un '
      'supersede con motivo y autor, jamás una edición.', tg_table_name, tg_op
      using errcode = 'insufficient_privilege';
  end
  $$;

comment on function rechazar_mutacion_de_hecho() is
  'Trigger de append-only del §7.4: rebota UPDATE, DELETE y TRUNCATE con 42501.';

-- Catálogo de tipos de evento. El §4.6 pide el tipo «catalogado» y no un enum: cada hito
-- agrega los suyos con INSERT, sin migración, igual que un vertical nuevo (§4.9).
create table evento_tipo (
  id          uuid not null default uuidv7(),
  tenant_id   uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo      text not null,
  descripcion text not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo)
);
create index evento_tipo_tenant_codigo_idx on evento_tipo (tenant_id, codigo);
comment on table evento_tipo is
  'PLANIFICACIÓN — catálogo de tipos de evento. Se edita con red y rebota; cada hito siembra '
  'los suyos con INSERT, sin migración.';

-- eventos: el orden autoritativo del tenant. El estado visible es proyección de esta tabla
-- (§4.6), así que su secuencia es monotónica POR TENANT — y como cada tenant es una BD
-- propia (§4.1), una secuencia de Postgres ya es exactamente eso, sin trucos.
create sequence eventos_secuencia_seq;

create table eventos (
  id             uuid        not null default uuidv7(),
  tenant_id      uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  secuencia      bigint      not null default nextval('eventos_secuencia_seq'),
  tipo_id        uuid        not null,
  objeto_tabla   text        not null,
  objeto_id      uuid        not null,
  actor_id       uuid,
  dispositivo_id uuid,
  -- Doble reloj (§4.6): cuándo pasó según el dispositivo, con su huso, y cuándo lo supo el
  -- servidor. Sin los dos, una captura offline de ayer se lee como de hoy.
  event_time     timestamptz not null,
  tz_offset_min  int         not null,
  record_time    timestamptz not null default now(),
  payload        jsonb       not null default '{}'::jsonb,
  client_uuid    uuid,
  event_hash     bytea,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, secuencia),
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, tipo_id) references evento_tipo (tenant_id, id),
  constraint eventos_hash_de_32_bytes check (event_hash is null or octet_length(event_hash) = 32)
);
create index eventos_tenant_tipo_idx on eventos (tenant_id, tipo_id);
create index eventos_tenant_objeto_idx on eventos (tenant_id, objeto_tabla, objeto_id);
comment on table eventos is
  'CAPTURA — hechos del terreno. Entran siempre (2xx + flag, §4.2), jamás rebotan, y son el '
  'orden autoritativo del tenant: el estado visible es proyección de acá.';

create trigger eventos_append_only
  before update or delete on eventos
  for each row execute function rechazar_mutacion_de_hecho();
create trigger eventos_append_only_truncate
  before truncate on eventos
  for each statement execute function rechazar_mutacion_de_hecho();

-- evidence: LA MISMA tabla para el POD y para los verticales (§4.6). El sha256 viaja en la
-- mutación ANTES del binario, así que es obligatorio en cuanto hay archivo — y no antes:
-- una firma o un PIN no tienen binario que hashear.
create type evidencia_tipo as enum (
  'firma', 'foto', 'lectura', 'indicador_visual',
  'archivo_logger', 'documento', 'pin_destinatario', 'escaneo_codigo'
);

create table evidence (
  id            uuid           not null default uuidv7(),
  tenant_id     uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  tipo          evidencia_tipo not null,
  objeto_tabla  text           not null,
  objeto_id     uuid           not null,
  archivo_url   text,
  sha256        bytea,
  valor         text,
  capturada_en  timestamptz    not null,
  tz_offset_min int            not null,
  record_time   timestamptz    not null default now(),
  client_uuid   uuid,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  constraint evidence_binario_con_sha256 check (archivo_url is null or sha256 is not null),
  constraint evidence_sha256_de_32_bytes check (sha256 is null or octet_length(sha256) = 32)
);
create index evidence_tenant_objeto_idx on evidence (tenant_id, objeto_tabla, objeto_id);
comment on table evidence is
  'CAPTURA — evidencia de POD y de verticales, write-once. El sha256 es obligatorio cuando '
  'hay binario; un mismatch al re-hashear es flag, jamás rebote (§4.6).';

create trigger evidence_append_only
  before update or delete on evidence
  for each row execute function rechazar_mutacion_de_hecho();
create trigger evidence_append_only_truncate
  before truncate on evidence
  for each statement execute function rechazar_mutacion_de_hecho();

-- audit_trail: quién tocó qué. Retención ≥ la del registro auditado (§4.6), y la forma de
-- garantizarla es que de acá no se borra NADA: append-only como los hechos.
create table audit_trail (
  id          uuid        not null default uuidv7(),
  tenant_id   uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  tabla       text        not null,
  registro_id uuid        not null,
  operacion   text        not null,
  actor_id    uuid,
  rol_bd      text        not null default current_user,
  antes       jsonb,
  despues     jsonb,
  ocurrido_en timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  constraint audit_trail_operacion_cerrada check (operacion in ('INSERT', 'UPDATE', 'DELETE'))
);
create index audit_trail_tenant_registro_idx on audit_trail (tenant_id, tabla, registro_id);
comment on table audit_trail is
  'CAPTURA — rastro de auditoría escrito por trigger. Append-only: la retención ≥ la del '
  'registro auditado se sostiene porque de acá no se borra nada (§4.6, §7.4).';

create trigger audit_trail_append_only
  before update or delete on audit_trail
  for each row execute function rechazar_mutacion_de_hecho();
create trigger audit_trail_append_only_truncate
  before truncate on audit_trail
  for each statement execute function rechazar_mutacion_de_hecho();

-- El trigger reutilizable que alimenta `audit_trail`. Las tablas de los hitos b–f lo enganchan
-- con una línea; acá queda enganchado a `review_queue`, la única tabla mutable que este
-- módulo crea, para que el mecanismo nazca ejercido y no como código que nadie corrió.
create or replace function auditar() returns trigger
  language plpgsql as $$
  declare
    v_antes   jsonb;
    v_despues jsonb;
    v_id      uuid;
  begin
    if tg_op in ('UPDATE', 'DELETE') then
      v_antes := to_jsonb(old);
      v_id := old.id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      v_despues := to_jsonb(new);
      v_id := new.id;
    end if;
    insert into audit_trail (tabla, registro_id, operacion, antes, despues)
      values (tg_table_name, v_id, tg_op, v_antes, v_despues);
    return null;
  end
  $$;

comment on function auditar() is
  'Trigger AFTER que escribe audit_trail. Se engancha por tabla: `create trigger … after '
  'insert or update or delete on <tabla> for each row execute function auditar()`.';

-- client_metric: telemetría del cliente, ingerida en lote por el MISMO endpoint de sync
-- (2xx siempre, §4.6). Los paneles del §10 leen SOLO de acá y de `eventos`.
create type metrica_cliente as enum (
  'toques_flujo', 'eviccion_idb', 'persist_denegado', 'outbox_profundidad',
  'outbox_edad_max', 'pwa_version', 'sync_error', 'latencia_ms'
);

create table client_metric (
  id             uuid            not null default uuidv7(),
  tenant_id      uuid            not null default tenant_actual() check (tenant_id = tenant_actual()),
  dispositivo_id uuid,
  tipo           metrica_cliente not null,
  flujo          text,
  valor_int      bigint          not null,
  ts             timestamptz     not null,
  tz_offset_min  int             not null,
  record_time    timestamptz     not null default now(),
  -- NOT NULL, a diferencia del de `eventos`: acá el §4.6 lo pide único sin excepción, porque
  -- la ingesta es en lote y reintentada, y sin él un reintento duplicaría cada métrica.
  client_uuid    uuid            not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid)
);
create index client_metric_tenant_tipo_idx on client_metric (tenant_id, tipo, ts);
comment on table client_metric is
  'CAPTURA — telemetría del dispositivo, ingerida en lote por el endpoint de sync (2xx '
  'siempre). Append-only: una métrica corregida a mano deja de ser una medición.';

create trigger client_metric_append_only
  before update or delete on client_metric
  for each row execute function rechazar_mutacion_de_hecho();
create trigger client_metric_append_only_truncate
  before truncate on client_metric
  for each statement execute function rechazar_mutacion_de_hecho();

-- review_queue: «Por revisar». La única tabla mutable de este archivo — su ciclo de vida ES
-- una transición. La ESCALA de `severidad` y las filas que nacen por degradación las fija el
-- módulo 04 (hito e), así que acá `severidad` es texto libre a propósito: inventarle una
-- escala sería fijar en el esquema una decisión que no es de este módulo.
create type revision_estado as enum ('nueva', 'reconocida', 'resuelta');

create table review_queue (
  id            uuid            not null default uuidv7(),
  tenant_id     uuid            not null default tenant_actual() check (tenant_id = tenant_actual()),
  origen        text            not null,
  severidad     text            not null,
  asignado_a    uuid,
  sla_vence_en  timestamptz,
  estado        revision_estado not null default 'nueva',
  nota          text,
  creada_en     timestamptz     not null default now(),
  reconocida_en timestamptz,
  resuelta_en   timestamptz,
  primary key (id),
  unique (tenant_id, id),
  constraint review_queue_resuelta_con_nota check (estado <> 'resuelta' or nota is not null)
);
create index review_queue_tenant_estado_idx on review_queue (tenant_id, estado, creada_en);
comment on table review_queue is
  'PLANIFICACIÓN — cola «Por revisar». Se opera con red y sus transiciones rebotan; la '
  'conducta (nueva→reconocida→resuelta y su 422) es del módulo 05.';

create trigger review_queue_auditada
  after insert or update or delete on review_queue
  for each row execute function auditar();
