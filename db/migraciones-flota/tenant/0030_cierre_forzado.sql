-- 0030 — El cierre forzado de un turno abierto, y el catálogo de motivos. [AC-FVEH-22]
--
-- Criterio congelado **KR-41**, decisión del dueño del 08-ago-2026 (D2). Hasta hoy el semáforo
-- detectaba el turno sin cerrar —rojo del Anexo B: «turno sin cerrar >1 h tras el fin del
-- bloque», «turno abierto cruzando medianoche»— sin que existiera acción alguna que lo
-- resolviera. Un rojo sin salida, contra el contrato del §5.6 de que la cola tiende a cero cada
-- día. Esta migración le da la salida.
--
-- ─── `motivos`: el catálogo del §4.5, que nace acá porque acá se lo necesita ────────
--
-- El §4.5 lo describe: «**motivos** por tenant(estado_asociado, require_notes, orden; se
-- apagan, jamás DELETE)». Se APAGAN y no se borran porque un motivo usado en un cierre de hace
-- tres meses tiene que seguir existiendo para que ese cierre siga diciendo por qué ocurrió.
-- Nace vacío: los motivos son del tenant, y el seed es del hito (g).
--
-- ─── CERRADO POR LA FUERZA ES UN ESTADO DISTINTO ───────────────────────────────────
--
-- El AC lo pide con esas palabras: «distinguible de un cierre real para liquidación y
-- reportes». Si fuera el mismo `cerrado` con una columna al lado, cualquier consulta que
-- olvidara mirar esa columna estaría contando una jornada que nadie cerró como si un chofer la
-- hubiera cerrado — y el módulo de liquidación cobra sobre eso.

create table motivos (
  id              uuid    not null default uuidv7(),
  tenant_id       uuid    not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo          text    not null,
  etiqueta        text    not null,
  -- A qué estado acompaña este motivo. `turno_cerrado_forzado` es el primero que existe; los
  -- de paradas y devoluciones llegan con los hitos d y e.
  estado_asociado text    not null,
  require_notes   boolean not null default false,
  orden           int     not null default 0,
  -- Se APAGAN, jamás DELETE (§4.5): un motivo usado hace tres meses tiene que seguir
  -- existiendo para que ese acto siga diciendo por qué ocurrió.
  activo          boolean not null default true,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo),
  constraint motivos_codigo_no_vacio check (length(btrim(codigo)) > 0),
  constraint motivos_etiqueta_no_vacia check (length(btrim(etiqueta)) > 0)
);
create index motivos_tenant_estado_idx on motivos (tenant_id, estado_asociado, orden);

comment on table motivos is
  'PLANIFICACIÓN — catálogo de motivos por tenant (§4.5). Se apagan con `activo`, jamás se '
  'borran: un motivo usado hace tres meses tiene que seguir diciendo por qué ocurrió un acto.';

/** El estado nuevo. Va con ALTER TYPE porque el enum ya existe desde la 0018, donde se dejó
 *  escrito que este valor lo agregaría su propio AC. */
alter type turno_estado add value if not exists 'cerrado_forzado';

insert into evento_tipo (codigo, descripcion) values
  ('turno.cerrado_forzado', 'Se cerró por la fuerza un turno que había quedado abierto, con motivo');
