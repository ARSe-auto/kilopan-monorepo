-- 0031 — El CHECK de coherencia del turno aprende el estado nuevo. [AC-FVEH-22]
--
-- Va en su propia migración porque `ALTER TYPE … ADD VALUE` no puede usarse en la misma
-- transacción que lo agrega. Es una limitación de PostgreSQL, no una elección de estilo, y
-- decirlo evita que alguien intente juntarlas la próxima vez.
--
-- El cierre forzado tiene fecha de cierre, como un cierre real: lo que lo distingue es el
-- estado, no la ausencia del dato. Y lleva MOTIVO obligatorio, que es lo único que hace que
-- un turno cerrado por la fuerza se pueda leer tres meses después.

alter table turnos
  add column cierre_motivo_id uuid,
  add column cierre_nota      text;

create index turnos_tenant_motivo_idx on turnos (tenant_id, cierre_motivo_id);

alter table turnos
  add constraint turnos_cierre_motivo_fkey
    foreign key (tenant_id, cierre_motivo_id) references motivos (tenant_id, id);

alter table turnos drop constraint turnos_cierre_coherente;

alter table turnos add constraint turnos_cierre_coherente check (
  (estado = 'abierto' and cerrado_en is null)
  or (estado = 'cerrado' and cerrado_en is not null and cerrado_en > abierto_en)
  -- El forzado exige las dos cosas: fecha Y motivo. Un cierre por la fuerza sin motivo es
  -- indistinguible de un dato perdido, y el §5.6 pide que la cola tienda a cero con actos que
  -- alguien pueda explicar.
  or (estado = 'cerrado_forzado' and cerrado_en is not null and cerrado_en > abierto_en
      and cierre_motivo_id is not null)
  or (estado = 'anulado' and (cerrado_en is null or cerrado_en > abierto_en))
);

comment on column turnos.cierre_motivo_id is
  'El motivo tipado del cierre forzado (§4.5, KR-41). Obligatorio en `cerrado_forzado`: sin él '
  'el cierre es indistinguible de un dato perdido.';
