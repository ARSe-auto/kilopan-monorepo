-- 0005 — Break-glass: el acceso de emergencia, con doble control. [AC-FIDN-18] §4.3, §7.9.
--
-- QUÉ ES Y POR QUÉ NO ES UN GRANT. Un grant de soporte lo otorga el DUEÑO del tenant
-- (AC-FIDN-11). El break-glass existe para el caso en que el dueño NO está disponible —
-- incomunicado, de madrugada, con el sistema caído— y por eso no puede depender de él.
--
-- LOS DOS CONTROLES SON DOS PERSONAS DE LA PLATAFORMA, decisión de Alexis del 09-ago-2026
-- (pregunta 7). Exigirle uno de los dos al dueño lo convertiría en un grant normal con otro
-- nombre y dejaría sin cubrir el único caso que lo justifica. Que sean DISTINTAS lo garantiza
-- un CHECK: la regla del §7.9 no puede quedar en la disciplina de quien la escribe.
--
-- Y ES INMUTABLE. Un registro de break-glass que se pueda editar o borrar no sirve de nada:
-- justamente lo que audita es el acceso de quien tiene todos los permisos. Lleva el mismo
-- append-only del §7.4 que las tablas de hechos del tenant — dos capas, trigger de fila y de
-- sentencia, con 42501 por los dos caminos.

create or replace function rechazar_mutacion_de_registro() returns trigger
  language plpgsql as $$
  begin
    raise exception
      'la tabla % es append-only (§7.4/§7.9): % está prohibido. Un registro de acceso que se '
      'puede editar no audita nada.', tg_table_name, tg_op
      using errcode = 'insufficient_privilege';
  end
  $$;

-- SIN FK a `tenants`, y es una decisión, no un olvido. Esta tabla es append-only: con una FK,
-- un tenant que alguna vez tuvo un acceso de emergencia quedaría IMPOSIBLE de borrar para
-- siempre — y el offboarding del §4.1 existe y es un derecho del tenant, no un favor. El
-- registro tiene que SOBREVIVIR al tenant, no impedir que se vaya. Por eso viaja también su
-- slug: cuando la fila de `tenants` ya no esté, el registro tiene que seguir siendo legible.
create table break_glass (
  id             uuid        not null primary key default uuidv7(),
  tenant_id      uuid        not null,
  tenant_slug    text        not null,
  solicitado_por text        not null,
  aprobado_por   text        not null,
  motivo         text        not null,
  abierto_en     timestamptz not null default now(),
  expira_en      timestamptz not null,
  -- El aviso al tenant no es opcional ni posterior: la fila nace con el id de la señal que el
  -- dueño ve en SU panel. Sin ese id, el break-glass no está notificado, y el §7.9 llama a
  -- eso «notificación forzosa» — forzosa quiere decir que no hay camino sin ella.
  aviso_id       uuid        not null,
  -- EL DOBLE CONTROL, como restricción y no como costumbre.
  constraint break_glass_dos_personas_distintas check (solicitado_por <> aprobado_por),
  constraint break_glass_motivo_no_vacio check (length(btrim(motivo)) > 0),
  constraint break_glass_con_vencimiento check (expira_en > abierto_en)
);
create index break_glass_tenant_idx on break_glass (tenant_id);
comment on table break_glass is
  'CAPTURA — accesos de emergencia de la plataforma, con doble control y aviso forzoso al '
  'tenant. Append-only: lo que audita es el acceso de quien tiene todos los permisos.';

create trigger break_glass_append_only
  before update or delete on break_glass
  for each row execute function rechazar_mutacion_de_registro();
create trigger break_glass_append_only_truncate
  before truncate on break_glass
  for each statement execute function rechazar_mutacion_de_registro();
