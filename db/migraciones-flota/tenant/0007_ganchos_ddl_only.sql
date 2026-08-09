-- 0007 — Ganchos DDL-only del §4.9: esquema sin activar. [AC-FTEN-15]
--
-- La tabla del §4.9 marca estos ganchos como **DDL-only**: el esquema nace ahora porque las
-- tablas nacen en `tenant_template` y agregarlas después obligaría a migrar datos que ya
-- existen, pero NO hay seeds, NO hay UI y NO hay feature encendida. La UI de `disposition` es
-- E3; las reglas de alarma las siembra el tenant que compre frío.
--
-- Dos cosas SÍ nacen vivas, y el §4.9 lo dice explícitamente:
--   · el CHECK de la matriz de honestidad sobre `alarm_rule`;
--   · el trigger de `excursion`, que es una derivada recalculable ante backfill — pero queda
--     INERTE mientras no haya reglas sembradas.

-- --- Quién dice qué mide: el registro de ProveedorTelemetria (§4.9) -----------------------
-- La interfaz tiene UNA implementación en E1: `declarada`, o sea que alguien tecleó el número.
-- Este registro es lo que hace VERIFICABLE la matriz de honestidad: sin saber de dónde salen
-- los datos de un tenant, «prohibido prometer compliance con datos declarados» sería una frase
-- en un documento en vez de un rebote de la base.
create table proveedor_telemetria (
  id        uuid           not null default uuidv7(),
  tenant_id uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  fuente    lectura_fuente not null,
  activo    boolean        not null default true,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, fuente)
);
create index proveedor_telemetria_tenant_fuente_idx on proveedor_telemetria (tenant_id, fuente);
comment on table proveedor_telemetria is
  'PLANIFICACIÓN — qué fuentes de telemetría tiene activas el tenant. En E1 la única '
  'implementación de la interfaz es `declarada` (§4.9); registrarla es lo que vuelve '
  'verificable la matriz de honestidad del §7.7.';

-- El registro de la única implementación de E1. NO es un seed de negocio: es la declaración de
-- que la interfaz existe con exactamente una implementación, que es lo que el §4.9 pide.
insert into proveedor_telemetria (fuente, activo) values ('declarada', true);

-- --- thermal_profile: DDL-only ------------------------------------------------------------
create table thermal_profile (
  id             uuid not null default uuidv7(),
  tenant_id      uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo         text not null,
  -- Centésimas de grado, enteras (§0 unidades). Cero decimales flotando en una cadena de frío.
  min_centesimas int  not null,
  max_centesimas int  not null,
  tolerancia_min int  not null default 0,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo),
  constraint thermal_profile_rango_valido check (max_centesimas > min_centesimas)
);
create index thermal_profile_tenant_codigo_idx on thermal_profile (tenant_id, codigo);
comment on table thermal_profile is
  'PLANIFICACIÓN — perfiles térmicos por tipo de carga. DDL-only en E1: sin seeds y sin UI '
  '(§4.9).';

-- --- alarm_rule: DDL-only, con el CHECK VIVO de la matriz de honestidad --------------------
-- `instantanea` dispara con una lectura fuera de rango. `cumulative` acumula tiempo fuera de
-- rango — y eso solo se puede sostener con una fuente que MIDA sola: una serie de números
-- tecleados no tiene resolución temporal para acumular nada.
create type alarma_tipo as enum ('instantanea', 'cumulative');

create table alarm_rule (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  thermal_profile_id uuid        not null,
  tipo               alarma_tipo not null,
  minutos_fuera      int,
  activa             boolean     not null default false,
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, thermal_profile_id) references thermal_profile (tenant_id, id),
  constraint alarm_rule_acumulada_con_minutos
    check ((tipo = 'cumulative') = (minutos_fuera is not null))
);
create index alarm_rule_tenant_perfil_idx on alarm_rule (tenant_id, thermal_profile_id);
comment on table alarm_rule is
  'PLANIFICACIÓN — reglas de alarma térmica. DDL-only en E1: sin seeds. El CHECK de la matriz '
  'de honestidad (§7.7) sí nace VIVO.';

/**
 * LA MATRIZ DE HONESTIDAD (§4.9, §7.7), viva desde el día uno.
 *
 * Prohibido ACTIVAR una alarma `cumulative` en un tenant cuya única fuente de telemetría sea
 * `declarada`. Una alarma acumulativa promete «estuvo 40 minutos fuera de rango»; con números
 * tecleados a mano eso no se puede saber, y prometerlo igual es venderle a un cliente una
 * garantía que el sistema no puede sostener. El §7.7 lo prohíbe y acá rebota.
 *
 * Se verifica al ACTIVAR y no al crear: la fila puede existir apagada —el tenant la deja lista
 * para cuando compre sondas— y el rebote llega en el momento en que se pretende que sirva.
 */
create or replace function honestidad_de_la_alarma() returns trigger
  language plpgsql as $$
  declare
    v_solo_declarada boolean;
  begin
    if not new.activa or new.tipo <> 'cumulative' then
      return new;
    end if;
    select bool_and(fuente = 'declarada') into v_solo_declarada
      from proveedor_telemetria where activo;
    if coalesce(v_solo_declarada, true) then
      raise exception
        'no se puede activar una alarma acumulativa en un tenant cuya única fuente es '
        '«declarada»: una serie de números tecleados no tiene con qué sostener «estuvo N '
        'minutos fuera de rango» (§7.7 matriz de honestidad)'
        using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

comment on function honestidad_de_la_alarma() is
  'Matriz de honestidad del §7.7: prohíbe ACTIVAR una alarma acumulativa cuando la única '
  'fuente de telemetría del tenant es `declarada`.';

create trigger alarm_rule_honestidad
  before insert or update on alarm_rule
  for each row execute function honestidad_de_la_alarma();

-- --- excursion: trigger VIVO pero INERTE ---------------------------------------------------
-- Es una DERIVADA y por eso el trigger nace vivo: si mañana entra un backfill de lecturas, las
-- excursiones se recalculan solas en vez de quedar un hueco que nadie nota. Pero sin
-- `alarm_rule` sembradas no produce nada — inerte, no apagado, que no es lo mismo: apagado
-- habría que acordarse de encenderlo.
create table excursion (
  id            uuid        not null default uuidv7(),
  tenant_id     uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  alarm_rule_id uuid        not null,
  reading_id    uuid        not null,
  valor_int     int         not null,
  detectada_en  timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, alarm_rule_id, reading_id),
  foreign key (tenant_id, alarm_rule_id) references alarm_rule (tenant_id, id)
);
create index excursion_tenant_regla_idx on excursion (tenant_id, alarm_rule_id, detectada_en desc);
comment on table excursion is
  'CAPTURA — excursiones de rango, derivadas de `reading` por trigger y recalculables ante un '
  'backfill. Inerte mientras no haya alarm_rules sembradas (§4.9).';

create or replace function detectar_excursion() returns trigger
  language plpgsql as $$
  begin
    insert into excursion (alarm_rule_id, reading_id, valor_int)
    select r.id, new.id, new.valor_int
      from alarm_rule r
      join thermal_profile p on p.id = r.thermal_profile_id
     where r.activa
       and r.tipo = 'instantanea'
       and (new.valor_int < p.min_centesimas or new.valor_int > p.max_centesimas)
    on conflict (tenant_id, alarm_rule_id, reading_id) do nothing;
    return null;
  end
  $$;

comment on function detectar_excursion() is
  'Deriva excursiones desde una lectura nueva. Sin alarm_rules activas no produce nada: el '
  'gancho es inerte, no está apagado (§4.9).';

create trigger reading_detecta_excursion
  after insert on reading
  for each row execute function detectar_excursion();

-- --- disposition + auto-release: DDL-only y APPEND-ONLY -------------------------------------
-- La UI es E3 (§4.9). Nace append-only por el §7.4: una disposición —«esta carga queda
-- retenida»— es un hecho con consecuencias, y corregirla es un supersede con motivo y autor,
-- jamás una edición.
create type disposicion_estado as enum ('retenida', 'liberada', 'rechazada');

create table disposition (
  id            uuid               not null default uuidv7(),
  tenant_id     uuid               not null default tenant_actual() check (tenant_id = tenant_actual()),
  objeto_tabla  text               not null,
  objeto_id     uuid               not null,
  estado        disposicion_estado not null,
  motivo        text               not null,
  -- auto-release: cuándo se libera sola si nadie decide. La CONDUCTA que la aplica es E3; acá
  -- está el dato, que es lo que el §4.9 pide como DDL-only.
  auto_release_en timestamptz,
  decidida_en   timestamptz        not null default now(),
  primary key (id),
  unique (tenant_id, id),
  constraint disposition_motivo_no_vacio check (length(btrim(motivo)) > 0)
);
create index disposition_tenant_objeto_idx on disposition (tenant_id, objeto_tabla, objeto_id);
comment on table disposition is
  'CAPTURA — disposición de una carga (retenida, liberada, rechazada) con su auto-release. '
  'DDL-only en E1, la UI es E3; append-only por el §7.4: se corrige con un supersede.';

create trigger disposition_append_only
  before update or delete on disposition
  for each row execute function rechazar_mutacion_de_hecho();
create trigger disposition_append_only_truncate
  before truncate on disposition
  for each statement execute function rechazar_mutacion_de_hecho();
