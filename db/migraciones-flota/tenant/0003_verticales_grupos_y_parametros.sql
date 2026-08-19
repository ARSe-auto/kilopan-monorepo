-- 0003 — Plantilla de vertical, árbol de grupos y parámetros del tenant (§4.4). [AC-FTEN-12]
--
-- Las tres son configuración por tenant: se editan CON red y rebotan, así que las tres son
-- PLANIFICACIÓN (§4.2).
--
-- Lo que este archivo NO trae: la APLICACIÓN de la visibilidad por grupos —qué entidades se
-- adscriben a un grupo, qué superficies filtra y cómo compone con el rol— sigue BLOQUEADA
-- por la Pregunta al dueño 12 y vive en AC-FTEN-27. Acá está el árbol y su invariante, nada
-- más: ninguna superficie asume grupos todavía.

-- vertical_template: un vertical es UNA FILA, no una migración (§4.9, métrica 4 del §2).
-- `meta_eevd` es COLUMNA y NOT NULL a propósito: el §2 exige que la meta viva en el esquema
-- y jamás en prosa, y un vertical sembrado sin meta tiene que rebotar en la BD.
create table vertical_template (
  id           uuid    not null default uuidv7(),
  tenant_id    uuid    not null default tenant_actual() check (tenant_id = tenant_actual()),
  vertical     text    not null,
  terminologia jsonb   not null default '{}'::jsonb,
  motivos      text[]  not null default '{}',
  -- Estructurados (título, ítems, obligatoriedad): `jsonb` y no `text[]`, a diferencia de
  -- `motivos` y `cargo_types`, que sí son listas planas de códigos.
  checklists   jsonb   not null default '[]'::jsonb,
  cargo_types  text[]  not null default '{}',
  config_ev    jsonb   not null default '{}'::jsonb,
  meta_eevd    numeric not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, vertical),
  constraint vertical_template_meta_positiva check (meta_eevd > 0)
);
create index vertical_template_tenant_vertical_idx on vertical_template (tenant_id, vertical);
comment on table vertical_template is
  'PLANIFICACIÓN — un vertical es una FILA, jamás una migración (§4.9). La meta EEVD vive '
  'como columna por vertical, nunca en prosa (§2).';

-- grupos: el árbol ÚNICO de visibilidad, ortogonal al rol (§4.4).
create table grupos (
  id        uuid not null default uuidv7(),
  tenant_id uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  nombre    text not null,
  padre_id  uuid,
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, padre_id) references grupos (tenant_id, id)
);
create index grupos_tenant_padre_idx on grupos (tenant_id, padre_id);
comment on table grupos is
  'PLANIFICACIÓN — árbol único de visibilidad, ortogonal al rol (§4.4). Su APLICACIÓN a '
  'alguna superficie está bloqueada por la Pregunta al dueño 12 (AC-FTEN-27).';

-- Un ciclo no lo puede impedir una FK: `A padre de B` y `B padre de A` son dos filas cada una
-- perfectamente válida por separado. Hace falta recorrer la rama hacia arriba.
create or replace function grupos_sin_ciclos() returns trigger
  language plpgsql as $$
  declare
    ancestro uuid := new.padre_id;
    saltos   int  := 0;
  begin
    while ancestro is not null loop
      if ancestro = new.id then
        raise exception
          'el grupo % quedaría dentro de su propia rama: el árbol de visibilidad no admite '
          'ciclos (§4.4)', new.id
          using errcode = 'check_violation';
      end if;
      saltos := saltos + 1;
      -- Cinturón: si el árbol YA estuviera corrupto, el recorrido no puede quedarse colgado
      -- para siempre en vez de decirlo.
      if saltos > 10000 then
        raise exception 'el árbol de grupos ya tiene un ciclo que no pasa por %', new.id
          using errcode = 'check_violation';
      end if;
      select padre_id into ancestro from grupos where id = ancestro;
    end loop;
    return new;
  end
  $$;

comment on function grupos_sin_ciclos() is
  'Recorre la rama hacia arriba antes de aceptar un padre. Una FK no alcanza: cada fila de un '
  'ciclo es válida por separado.';

create trigger grupos_sin_ciclos_trg
  before insert or update of padre_id on grupos
  for each row execute function grupos_sin_ciclos();

-- parametros: una sola fila por BD, como `tenant_info` — en una BD por tenant, «por tenant»
-- ES «una fila». `unica boolean UNIQUE CHECK (unica)` dice «como mucho una» sin un trigger.
--
-- El dinero es CLP `bigint` entero, sin decimales y sin `numeric` (§0, §4.8): estas dos
-- columnas son las primeras columnas de monto REALES del proyecto y son las que el catálogo
-- de AC-FTEN-09 ejercita.
--
-- `factor_consumo` es NULLABLE a propósito y NO trae el 0,85 escrito acá. El §0 dice
-- «fórmula EV única con factor_consumo 0,85 y override en `parametros`»: el valor canónico
-- vive UNA vez, en `packages/nucleo-comun/src/constants.ts`, y esta columna es el override
-- del tenant. NULL = usar el canónico. Copiar el número al DDL sería exactamente el número
-- mágico duplicado que el grep-gate del §0 existe para atrapar (AC-FTEN-01).
create table parametros (
  id                        uuid    not null default uuidv7(),
  tenant_id                 uuid    not null default tenant_actual() check (tenant_id = tenant_actual()),
  unica                     boolean not null default true,
  reserva_pct               smallint,
  factor_consumo            numeric,
  tarifa_kwh_clp            bigint,
  precio_diesel_litro_clp   bigint,
  bultos_max_sin_receptor   int,
  primary key (id),
  unique (tenant_id, id),
  unique (unica),
  constraint parametros_una_sola_fila check (unica),
  constraint parametros_reserva_en_rango check (reserva_pct is null or reserva_pct between 0 and 100),
  constraint parametros_factor_positivo check (factor_consumo is null or factor_consumo > 0),
  constraint parametros_bultos_positivo check (bultos_max_sin_receptor is null or bultos_max_sin_receptor > 0)
);
create index parametros_tenant_idx on parametros (tenant_id);
comment on table parametros is
  'PLANIFICACIÓN — parámetros del tenant, una sola fila. Los montos son CLP bigint entero '
  '(§4.8); factor_consumo NULL significa «usar el canónico de constants.ts» (§0).';

comment on column parametros.factor_consumo is
  'Override del tenant sobre el factor de consumo EV. NULL = el valor canónico de la familia '
  'de constantes; el número no se copia acá (§0, grep-gate de AC-FTEN-01).';
