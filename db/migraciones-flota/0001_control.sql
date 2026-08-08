-- Plano de control de la Plataforma FLOTA. Fuente: docs/PROMPT_MAESTRO_FLOTA.md
-- §4.1 (Contrato multi-tenant — aislamiento físico por tenant) y §4.4 (Configuración
-- por tenant). Tabla canónica de constantes: §0.
--
-- SIMPLIFICACIÓN DELIBERADA DE HITO 0 (leer antes de tocar este archivo):
--
-- §4.1 dice que el plano de control es una BASE DE DATOS separada («BD `control`»), y
-- que `tenant_theme`/`tenant_terminology`/`tenant_feature_overrides` en la arquitectura
-- final viven DENTRO de cada BD física `t_<slug>` (aislamiento físico real), no en
-- `control`. Este Hito 0 no aprovisiona múltiples bases (no hay todavía runner de
-- migraciones ×N ni tenant canario, §4.1) — se prueba contra UN esquema `control` en UNA
-- sola instancia de PGlite local, para poder verificar los invariantes AHORA. Quien
-- construya el aprovisionamiento real (BD por tenant + runner canario) tiene que MOVER
-- esas tres tablas del esquema `control` a la plantilla por-tenant, no reescribir sus
-- CHECK desde cero — el contrato de columnas es el mismo, cambia solo dónde vive.
--
-- Por la misma razón, el patrón `tenant_id uuid NOT NULL ... CHECK (tenant_id =
-- (SELECT id FROM tenant_info))` de §4.1 NO aplica a las tablas de este archivo: ese
-- patrón es para tablas de DOMINIO dentro de una BD que pertenece a UN SOLO tenant (el
-- CHECK ancla contra la fila única de `tenant_info` de esa BD). Acá `control.tenants` es
-- exactamente el registro de TODOS los tenants — cada fila puede pertenecer a un tenant
-- distinto por diseño, así que no hay una constante contra la cual anclar.
--
-- Tampoco hay FKs compuestas `(tenant_id, id)` en este archivo: ese patrón (§4.1)
-- conserva la cadena de tenant_id cuando una tabla de dominio referencia OTRA tabla de
-- dominio dentro de la misma BD tenant. Ninguna tabla de acá referencia a otra que no
-- sea `control.tenants` directamente — no hay cadena todavía que componer.
create schema if not exists control;

-- ---------------------------------------------------------------------------
-- Guardrail de versión: uuidv7() es nativo desde PostgreSQL 18 (RFC 9562, verificado en
-- vivo contra PGlite 0.5.4, que lo embebe). §0 exige UUIDv7 generado en servidor como PK
-- de TODA tabla de dominio — jamás bigint, jamás v4 — así que este archivo depende de
-- esa función nativa en vez de reimplementarla a mano. Si el Postgres gestionado real
-- (fuera de PGlite) no la tiene todavía, esto falla FUERTE y temprano en vez de generar
-- PKs con el algoritmo equivocado en silencio.
do $$
begin
  perform uuidv7();
exception when undefined_function then
  raise exception
    'control: uuidv7() no existe — este esquema requiere PostgreSQL >= 18 (RFC 9562). '
    'Confirmar la versión del proveedor gestionado antes de aprovisionar tenants reales '
    '(ver docs/PROMPT_MAESTRO_FLOTA.md §0).';
end
$$;

-- ---------------------------------------------------------------------------
-- Planes SaaS (Anexo A: pricing seed, por vehículo/mes, CLP, público, mensual
-- cancelable). Catálogo de PLATAFORMA — no es por tenant.
-- ---------------------------------------------------------------------------
create table control.planes (
  id                  text primary key,
  nombre              text not null,
  precio_clp_mes      bigint not null check (precio_clp_mes >= 0), -- CLP: bigint, §0
  limite_vehiculos    integer check (limite_vehiculos is null or limite_vehiculos > 0),
  limite_entregas_mes integer check (limite_entregas_mes is null or limite_entregas_mes > 0),
  creado_at           timestamptz not null default now()
);
comment on table control.planes is
  'PLATAFORMA — catálogo público de planes (Anexo A). No es dato operativo de tenant.';

-- Únicos números que trae el Anexo A: la partida gratis (1 vehículo, 300 entregas/mes) y
-- los 4 precios. El resto de límites queda NULL (no dicho por el maestro) — no inventar.
insert into control.planes (id, nombre, precio_clp_mes, limite_vehiculos, limite_entregas_mes) values
  ('gratis',  'Partida gratis', 0,      1,    300),
  ('base',    'Base',           12900,  null, null),
  ('pro',     'Pro',            19900,  null, null),
  ('empresa', 'Empresa',        29900,  null, null);

-- ---------------------------------------------------------------------------
-- Catálogo de plantillas versionadas (§4.1: "la plantilla es un artefacto versionado
-- del repo y es la 4ª vida de todo cambio de esquema"). Este Hito 0 SOLO deja el
-- catálogo — el aprovisionamiento real (`CREATE DATABASE ... TEMPLATE`, runner con
-- tenant canario `t_canary`) es trabajo posterior; no se simula acá.
-- ---------------------------------------------------------------------------
create table control.tenant_templates (
  id          uuid primary key default uuidv7(),
  nombre      text not null unique,
  version     integer not null default 1 check (version > 0),
  descripcion text,
  creado_at   timestamptz not null default now()
);
comment on table control.tenant_templates is
  'PLATAFORMA — catálogo de plantillas de esquema versionadas. El clonado real de BD '
  '(CREATE DATABASE ... TEMPLATE) NO está construido en Hito 0.';

insert into control.tenant_templates (nombre, version, descripcion) values
  ('base-v1', 1, 'Plantilla base del núcleo tenancy — sin aprovisionamiento real todavía.');

-- ---------------------------------------------------------------------------
-- control.tenants — §4.1: "control.tenants(slug=subdominio, bd, plan_id, modo
-- mi_flota|daas, estado)".
-- ---------------------------------------------------------------------------
create table control.tenants (
  id                 uuid primary key default uuidv7(),
  slug               text not null unique
                       check (slug ~ '^[a-z][a-z0-9-]{2,31}$'), -- subdominio: *.plataforma.cl
  -- "Una base de datos por tenant (t_<slug>)" (§4.1) — GENERATED, no una columna que la
  -- app pueda desincronizar del slug con un UPDATE directo (Postgres rechaza escribir
  -- una columna generada sin que haga falta un trigger aparte).
  bd                 text generated always as ('t_' || slug) stored,
  plan_id            text not null references control.planes(id),
  modo               text not null check (modo in ('mi_flota', 'daas')), -- §3, cerrado
  -- `estado` NO lleva CHECK de enum a propósito: el maestro cierra los valores de `modo`
  -- (§3) pero en ningún punto (§4.1 ni §4.4) cierra los de `estado` — inventar un ciclo
  -- de vida (provisionando/activo/suspendido/offboarding...) sin que el maestro lo cierre
  -- sería inventar una decisión que no está tomada. Queda anotado como pregunta abierta.
  estado             text not null default 'activo',
  tenant_template_id uuid references control.tenant_templates(id),
  creado_at          timestamptz not null default now()
);
comment on table control.tenants is
  'PLATAFORMA — registro de tenants. Vive en el plano de control (§4.1); NUNCA datos '
  'operativos de dominio de ningún tenant.';

-- ---------------------------------------------------------------------------
-- control.tenant_theme — §4.4: "tenant_theme (logo_url, accent_color RECHAZADO si
-- <4.5:1, extras)". Contraste WCAG real contra blanco (texto blanco sobre el botón
-- primario, uso más común del acento en el sistema Miga, §5.1) — no una anotación en
-- prosa: si el color no alcanza el contraste, el INSERT/UPDATE falla.
-- ---------------------------------------------------------------------------
create or replace function control.fn_contraste_ok(hex text) returns boolean
language plpgsql immutable as $$
declare
  r double precision; g double precision; b double precision;
  rl double precision; gl double precision; bl double precision;
  luminancia double precision;
  contraste double precision;
  canal double precision;
begin
  if hex !~ '^#[0-9A-Fa-f]{6}$' then
    return false;
  end if;
  r := ('x' || substr(hex, 2, 2))::bit(8)::int / 255.0;
  g := ('x' || substr(hex, 4, 2))::bit(8)::int / 255.0;
  b := ('x' || substr(hex, 6, 2))::bit(8)::int / 255.0;

  canal := r;
  rl := case when canal <= 0.03928 then canal / 12.92 else power((canal + 0.055) / 1.055, 2.4) end;
  canal := g;
  gl := case when canal <= 0.03928 then canal / 12.92 else power((canal + 0.055) / 1.055, 2.4) end;
  canal := b;
  bl := case when canal <= 0.03928 then canal / 12.92 else power((canal + 0.055) / 1.055, 2.4) end;

  luminancia := 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  contraste := 1.05 / (luminancia + 0.05); -- contraste vs. blanco (WCAG 2.x)
  return contraste >= 4.5;
end;
$$;
comment on function control.fn_contraste_ok(text) is
  'WCAG 2.x: contraste del color contra blanco >= 4.5:1 (§0, §5.1). Texto blanco sobre '
  'el acento es el uso primario en Miga (botón primario full-width).';

create table control.tenant_theme (
  tenant_id     uuid primary key references control.tenants(id),
  logo_url      text,
  accent_color  text not null default '#1D4ED8' -- acentos.kiloruta, packages/miga/src/tokens.ts
                  check (control.fn_contraste_ok(accent_color)),
  extras        jsonb not null default '{}'::jsonb,
  actualizado_at timestamptz not null default now()
);
comment on table control.tenant_theme is
  'Rebrand de un tenant = 1 UPDATE, cero deploys (§2, métrica de plataforma obligatoria).';

-- ---------------------------------------------------------------------------
-- control.tenant_terminology — §4.4: "tenant_terminology (term_key, singular, plural;
-- CHECK de largo POR TIPO de term_key: navegación ≤12; términos de sistema/auditoría
-- excluidos por CHECK)". §0: títulos ≤24, descripciones ≤40, singular+plural
-- obligatorios, prohibidos # $ % ; < = >.
--
-- La categoría va codificada como PREFIJO del term_key (nav./titulo./desc.) en vez de
-- una tabla catálogo aparte: es la forma más directa de expresar "CHECK de largo POR
-- TIPO" con un CHECK de verdad (no un trigger) y deja "términos de sistema/auditoría
-- excluidos" como una imposibilidad ESTRUCTURAL — ninguna categoría fuera de esas tres
-- puede insertarse, así que un term_key de sistema/auditoría no es una fila que se
-- pueda crear, no una que se rechace en tiempo de ejecución.
-- ---------------------------------------------------------------------------
create table control.tenant_terminology (
  id             uuid primary key default uuidv7(),
  tenant_id      uuid not null references control.tenants(id),
  term_key       text not null,
  singular       text not null,
  plural         text not null,
  actualizado_at timestamptz not null default now(),
  unique (tenant_id, term_key),
  check (singular !~ '[#$%;<=>]' and plural !~ '[#$%;<=>]'),
  check (
    (term_key ~ '^nav\.[a-z0-9_]+$'    and length(singular) between 1 and 12 and length(plural) between 1 and 12) or
    (term_key ~ '^titulo\.[a-z0-9_]+$' and length(singular) between 1 and 24 and length(plural) between 1 and 24) or
    (term_key ~ '^desc\.[a-z0-9_]+$'   and length(singular) between 1 and 40 and length(plural) between 1 and 40)
  )
);
comment on table control.tenant_terminology is
  'Resolución tenant -> vertical -> base es-CL en UNA capa de copy (§5.1). Solo la capa '
  'tenant vive acá; vertical/base son constantes de código, no filas de BD.';

-- ---------------------------------------------------------------------------
-- Entitlements (patrón Stripe, §4.4/§6): features / plan_features /
-- tenant_feature_overrides. Efectivo = override ?? plan.
-- ---------------------------------------------------------------------------
create table control.features (
  lookup_key  text primary key,
  module      text not null,
  descripcion text,
  creado_at   timestamptz not null default now()
);
comment on table control.features is 'PLATAFORMA — catálogo de features togglables.';

-- Semilla MÍNIMA para probar la mecánica override ?? plan — no es la matriz real de
-- negocio. Las 4 nombradas en §3 (selector de modo: "tarifas, liquidación por cliente,
-- portal del contratante y facturación quedan OFF y ocultos" en modo mi_flota) más `vrp`
-- y `frio`, citadas explícitamente como toggles en §3/§4.9/Anexo A.
insert into control.features (lookup_key, module, descripcion) values
  ('tarifas',                'operacion', 'Rate card por empresa cliente (§3 E1.8)'),
  ('liquidacion_por_cliente', 'operacion', 'Liquidación línea=evidencia por empresa (§3 E1.9)'),
  ('portal_contratante',      'operacion', 'Portal /cliente/* del contratante (§3 E1.10)'),
  ('facturacion',             'billing',   'Emisión DTE vía puerto EmisorDTE (§3 E2)'),
  ('vrp',                     'operacion', 'Optimizador de rutas VROOM+OSRM (§3 E2)'),
  ('frio',                    'compliance','UI de cadena de frío básica (§3 E3)');

create table control.plan_features (
  plan_id            text not null references control.planes(id),
  feature_lookup_key text not null references control.features(lookup_key),
  incluido           boolean not null default true,
  primary key (plan_id, feature_lookup_key)
);
comment on table control.plan_features is
  'PLATAFORMA — qué feature trae cada plan por defecto. Semilla mínima de Hito 0, no la '
  'matriz de negocio real (queda para el hito que construya el panel admin).';

-- El plan `gratis` (1 vehículo) no lleva ninguna de estas — Anexo A no menciona
-- white-label/API/frío en la partida gratis. Los planes pagos las traen todas incluidas
-- salvo `frio`, que Anexo A liga explícitamente a Pro/Empresa ("Pro... frío básico").
insert into control.plan_features (plan_id, feature_lookup_key, incluido)
select p.id, f.lookup_key, true
from control.planes p
cross join control.features f
where p.id in ('base', 'pro', 'empresa')
  and f.lookup_key in ('tarifas', 'liquidacion_por_cliente', 'portal_contratante', 'facturacion', 'vrp');

insert into control.plan_features (plan_id, feature_lookup_key, incluido) values
  ('pro',     'frio', true),
  ('empresa', 'frio', true);

create table control.tenant_feature_overrides (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null references control.tenants(id),
  feature_lookup_key text not null references control.features(lookup_key),
  enabled            boolean not null,
  motivo             text,
  creado_at          timestamptz not null default now(),
  unique (tenant_id, feature_lookup_key)
);
comment on table control.tenant_feature_overrides is
  'admin_tenant apaga cualquier feature (override OFF siempre permitido) y enciende '
  'solo lo incluido en su plan (§5.5, pantalla "Funciones").';

create or replace function control.fn_entitlement_efectivo(p_tenant_id uuid, p_feature text)
returns boolean language sql stable as $$
  select coalesce(
    (select enabled from control.tenant_feature_overrides
      where tenant_id = p_tenant_id and feature_lookup_key = p_feature),
    (select pf.incluido
       from control.tenants t
       join control.plan_features pf on pf.plan_id = t.plan_id and pf.feature_lookup_key = p_feature
      where t.id = p_tenant_id),
    false
  );
$$;
comment on function control.fn_entitlement_efectivo(uuid, text) is
  'Entitlement efectivo = override ?? plan ?? false (§4.4, patrón Stripe Entitlements).';

-- ---------------------------------------------------------------------------
-- Rol de aplicación de mínimo privilegio. Mismo criterio que `pan_app` en KiloPan
-- (db/migraciones/0001_identidad.sql, AC-SEC-08): la app nunca se conecta como dueño del
-- esquema. Los GRANT van al final, después de que TODAS las tablas existen —
-- "GRANT ... ON ALL TABLES IN SCHEMA" no es retroactivo.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'control_app') then
    create role control_app login;
  end if;
end
$$;

grant usage on schema control to control_app;
grant select, insert, update on all tables in schema control to control_app;
revoke delete on all tables in schema control from control_app;
