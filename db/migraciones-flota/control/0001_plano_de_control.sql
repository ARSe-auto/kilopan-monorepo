-- 0001 — El plano de control (§4.1). [AC-FTEN-04]
--
-- `control` es la ÚNICA base compartida del cluster, y su regla es lo que NO tiene: cero
-- datos operativos de dominio. Encargos, vehículos, personas, evidencia, tarifas y montos
-- viven en la BD de su tenant y no salen de ahí (§4.1). Lo que vive acá es el registro de
-- quién es tenant, qué plan tiene, a quién se invitó, a quién se le dio soporte, y los
-- AGREGADOS TÉCNICOS que el job exportador empuja desde cada base.
--
-- Las tablas de acá NO llevan `tenant_id` ni CHECK contra la constante de la BD: por
-- definición son cross-tenant, y el linter las revisa con otra vara (solo les exige la clase
-- de la regla de oro).
--
-- Lo que este archivo NO trae: nada de cobro SaaS. Stripe, página pública de precios y toda
-- estructura de billing son E2 (§3 FUERA de E1) y billing ni siquiera figura en la tabla de
-- ganchos del §4.9, así que tampoco queda como DDL apagado. Y la RESOLUCIÓN del entitlement
-- efectivo (`override ?? plan`) es AC-FTEN-11: acá están las tablas y sus invariantes.

-- Los planes del Anexo A. Los límites cuantitativos son COLUMNAS del plan (§4.4), no filas
-- de una tabla de features: un límite es un número, no un interruptor.
create table planes (
  id                    uuid not null primary key default uuidv7(),
  lookup_key            text not null unique,
  nombre                text not null,
  limite_vehiculos      int,
  limite_entregas_mes   int
);
comment on table planes is
  'PLANIFICACIÓN — catálogo de planes. Los límites cuantitativos son columnas: un límite es '
  'un número, no un interruptor (§4.4).';

-- El registro de tenants: slug → BD, plan, modo, estado. Es lo que lee el ruteo en cada
-- request antes de abrir el pool de la BD del tenant (§4.1).
--
-- `estado` con sus tres valores y su semántica de fallo la dictó el dueño el 09-ago-2026
-- (Pregunta 9): `activo` sirve, `suspendido` responde 503 con cero acceso a su base, y
-- `archivado` responde 404 como si no existiera. La CONDUCTA del ruteo es AC-FTEN-05; acá
-- está el enum cerrado contra el que esa conducta se escribe.
create type tenant_estado as enum ('activo', 'suspendido', 'archivado');
create type tenant_modo   as enum ('mi_flota', 'daas');

create table tenants (
  id         uuid          not null primary key default uuidv7(),
  slug       text          not null unique,
  bd         text          not null unique,
  plan_id    uuid,
  modo       tenant_modo   not null default 'mi_flota',
  estado     tenant_estado not null default 'activo',
  creado_en  timestamptz   not null default now(),
  foreign key (plan_id) references planes (id),
  -- El nombre de la BD se DERIVA del slug (§0 naming de tenancy). Que la BD y el slug puedan
  -- divergir sería un tenant apuntando a la base de otro: el cruce que el §4.1 hace imposible
  -- por construcción se desharía en una fila de esta tabla.
  constraint tenants_bd_derivada_del_slug check (bd = 't_' || slug),
  constraint tenants_slug_citable check (slug ~ '^[a-z][a-z0-9_]{1,40}$')
);
create index tenants_plan_idx on tenants (plan_id);
comment on table tenants is
  'PLANIFICACIÓN — registro de tenants: slug, su BD, plan, modo y estado. Lo lee el ruteo '
  'antes de abrir el pool de la base del tenant (§4.1).';

-- --- Entitlements: 3 tablas, en `control` por respuesta del dueño a la Pregunta 3 ----------
-- El ruteo ya lee `control` para resolver el subdominio, así que el bootstrap no abre un
-- camino cross-database nuevo: viaja por el mismo. El entitlement efectivo se resuelve acá y
-- se congela en el snapshot de config del tenant, con lo cual el runtime del producto nunca
-- vuelve a consultar `control` (respuestas del 09-ago-2026, P3 y P4).
create table features (
  id         uuid not null primary key default uuidv7(),
  lookup_key text not null unique,
  module     text not null
);
comment on table features is
  'PLANIFICACIÓN — catálogo de features por módulo. Un vertical o un plan nuevo son filas, '
  'jamás una migración (§4.4).';

create table plan_features (
  plan_id    uuid not null,
  feature_id uuid not null,
  primary key (plan_id, feature_id),
  foreign key (plan_id) references planes (id),
  foreign key (feature_id) references features (id)
);
create index plan_features_feature_idx on plan_features (feature_id);
comment on table plan_features is
  'PLANIFICACIÓN — qué features trae cada plan. La resolución efectiva es AC-FTEN-11.';

create table tenant_feature_overrides (
  tenant_id  uuid    not null,
  feature_id uuid    not null,
  enabled    boolean not null,
  -- El motivo es NOT NULL a propósito: un override sin razón escrita es una excepción sin
  -- dueño, y a los seis meses nadie sabe si todavía corresponde (§10).
  motivo     text    not null,
  primary key (tenant_id, feature_id),
  foreign key (tenant_id) references tenants (id),
  foreign key (feature_id) references features (id),
  constraint tenant_feature_overrides_motivo_no_vacio check (length(btrim(motivo)) > 0)
);
create index tenant_feature_overrides_feature_idx on tenant_feature_overrides (feature_id);
comment on table tenant_feature_overrides is
  'PLANIFICACIÓN — excepciones por tenant sobre el plan, con motivo obligatorio. Efectivo = '
  'override ?? plan (§4.4).';

-- --- Invitaciones de tenant nuevo y grants de soporte -------------------------------------
-- Las invitaciones de ACÁ son las de dar de alta un tenant nuevo, distintas de las de
-- enrolamiento de personas del §4.3, que viven dentro de la BD del tenant (hito b).
create table invitaciones_tenant (
  id           uuid        not null primary key default uuidv7(),
  correo       text        not null,
  slug_sugerido text,
  token_hash   text        not null unique,
  expira_en    timestamptz not null,
  aceptada_en  timestamptz,
  tenant_id    uuid,
  foreign key (tenant_id) references tenants (id)
);
create index invitaciones_tenant_correo_idx on invitaciones_tenant (correo);
comment on table invitaciones_tenant is
  'PLANIFICACIÓN — invitaciones para dar de alta un tenant nuevo. Distintas de las de '
  'enrolamiento de personas del §4.3, que viven en la BD del tenant.';

-- Grants de soporte: cuándo e-auto entró a la base de un tenant, por qué y hasta cuándo.
-- Acotado en el tiempo y con motivo, porque un acceso de soporte sin vencimiento es un
-- acceso permanente con otro nombre.
create table grants_soporte (
  id          uuid        not null primary key default uuidv7(),
  tenant_id   uuid        not null,
  otorgado_a  text        not null,
  motivo      text        not null,
  otorgado_en timestamptz not null default now(),
  expira_en   timestamptz not null,
  revocado_en timestamptz,
  foreign key (tenant_id) references tenants (id),
  constraint grants_soporte_con_vencimiento check (expira_en > otorgado_en),
  constraint grants_soporte_motivo_no_vacio check (length(btrim(motivo)) > 0)
);
create index grants_soporte_tenant_idx on grants_soporte (tenant_id);
comment on table grants_soporte is
  'PLANIFICACIÓN — accesos de soporte a la base de un tenant, acotados en el tiempo y con '
  'motivo. Un grant sin vencimiento es un acceso permanente con otro nombre.';

-- --- Agregados técnicos del exportador ----------------------------------------------------
-- LA TABLA DEL CENTINELA 14. Su schema es FIJO y su contenido es técnico: salud, adopción,
-- EEVD agregada y backlog de sync. CERO columnas de dinero, tarifas o clientes — la
-- separación física del §4.1 garantiza que e-auto no vea datos comerciales del tenant, y esta
-- tabla es el único lugar donde esa garantía se podría perder por descuido.
--
-- El test de schema de AC-FTEN-04 la mira contra una lista literal: agregarle una columna de
-- monto acá pone el gate en rojo, sin necesidad de que a nadie se le ocurra revisarlo.
--
-- Los campos cuya fuente operativa todavía no existe quedan NULL hasta su hito: `eevd_semanal`
-- nace con el primer módulo operativo (§2, hito c) y `backlog_sync` con el motor de sync
-- (hito e). NULL declarado, no cero inventado: un cero diría «medido y da cero».
create table agregados_tecnicos (
  id                     uuid        not null primary key default uuidv7(),
  tenant_id              uuid        not null,
  ventana_inicio         timestamptz not null,
  ventana_fin            timestamptz not null,
  empujado_en            timestamptz not null default now(),
  -- salud
  eventos_ultima_hora    int,
  errores_sync_pct       numeric,
  -- adopción
  dispositivos_activos   int,
  usuarios_activos       int,
  pwa_version_min        text,
  -- EEVD agregada (hito c) y backlog de sync (hito e): NULL hasta que su fuente exista
  eevd_semanal           numeric,
  backlog_sync_max_min   int,
  foreign key (tenant_id) references tenants (id),
  constraint agregados_tecnicos_ventana_valida check (ventana_fin > ventana_inicio),
  unique (tenant_id, ventana_inicio)
);
create index agregados_tecnicos_tenant_idx on agregados_tecnicos (tenant_id, ventana_inicio desc);
comment on table agregados_tecnicos is
  'CAPTURA — agregados técnicos que el job exportador empuja desde cada BD tenant (§4.1). '
  'Schema FIJO: cero columnas de dinero, tarifas o clientes (centinela 14).';
