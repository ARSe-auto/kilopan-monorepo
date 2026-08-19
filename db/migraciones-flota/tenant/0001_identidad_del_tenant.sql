-- 0001 — Identidad de la base de un tenant y la constante contra la que todo se verifica.
--
-- Esta migración es la raíz de `tenant_template`: define QUÉ tenant es esta base. Toda tabla
-- de dominio que venga después lleva `CHECK (tenant_id = tenant_actual())`, así que la
-- función tiene que existir antes que cualquiera de ellas.
--
-- linter: exenta schema_migrations — es la contabilidad del runner, no una tabla de dominio.
-- linter: exenta tenant_info — es la fila que DEFINE la constante del tenant; no puede
-- llevar un CHECK contra sí misma.

create table if not exists schema_migrations (
  version     text        not null primary key,
  sha256      text        not null,
  aplicada_en timestamptz not null default now()
);
comment on table schema_migrations is
  'PLANIFICACIÓN — contabilidad del runner de migraciones. Se escribe en el deploy, con red.';

-- Una sola fila, para siempre: `unica boolean UNIQUE CHECK (unica)` es la forma de decir
-- «como mucho una» sin un trigger. Dos identidades en una misma base serían dos tenants
-- compartiendo datos, que es exactamente lo que el §4.1 existe para hacer imposible.
create table if not exists tenant_info (
  id    uuid    not null primary key,
  slug  text    not null,
  unica boolean not null default true unique check (unica)
);
comment on table tenant_info is
  'PLANIFICACIÓN — identidad de esta base. Una sola fila, sembrada al provisionar el tenant.';

-- LA CONSTANTE DE LA BD (§0 «CHECK = constante de la BD», §4.1).
--
-- El §4.1 la escribe `(SELECT id FROM tenant_info)` dentro del CHECK, y PostgreSQL rechaza
-- esa forma: «cannot use subquery in check constraint» (verificado contra 18.4). Acá el
-- valor va HORNEADO como literal: `provisionar.mjs` reemplaza esta función con el uuid real
-- del tenant en el momento de crear su base.
--
-- Que sea un literal y no una lectura de tabla no es un rodeo, es lo correcto: (a) hace que
-- IMMUTABLE sea verdad y no una mentira conveniente, y (b) sobrevive a `pg_restore`, donde
-- las funciones se crean ANTES de que llegue el COPY de los datos — un CHECK que leyera
-- `tenant_info` fallaría en cada fila del restore porque esa tabla todavía estaría vacía, y
-- el offboarding del §2 (métrica 7) es justamente un dump seguido de un restore.
--
-- En la plantilla devuelve el uuid centinela de abajo: la plantilla no es un tenant.
create or replace function tenant_actual() returns uuid
  language sql immutable parallel safe
  as $$ select '00000000-0000-7000-8000-000000000000'::uuid $$;

comment on function tenant_actual() is
  'Constante de esta base: el uuid del tenant, horneado al provisionar. En tenant_template '
  'devuelve el centinela 00000000-0000-7000-8000-000000000000.';

-- Coherencia entre la función y la fila. Se verifica en el gate y tras cada provisión:
-- si alguna vez divergen, todos los CHECK de tenant_id estarían validando contra un tenant
-- distinto del que dice ser la base — la fuga de aislamiento más silenciosa posible.
create or replace function tenant_coherente() returns boolean
  language sql stable
  as $$
    select case
      when (select count(*) from tenant_info) = 0
        then tenant_actual() = '00000000-0000-7000-8000-000000000000'::uuid
      else tenant_actual() = (select id from tenant_info)
    end
  $$;

comment on function tenant_coherente() is
  'Verdadero si tenant_actual() concuerda con tenant_info: sin fila, debe ser el centinela '
  'de la plantilla; con fila, debe ser su id.';
