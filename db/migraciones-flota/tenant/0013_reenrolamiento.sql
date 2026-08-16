-- 0013 — «Ya tengo cuenta»: el teléfono nuevo (§4.3, §5.4 F-E). [AC-FIDN-08]
--
-- POR QUÉ HACE FALTA DISTINGUIR. Una solicitud NUEVA con un RUT que ya está registrado
-- rebota al aprobar (AC-FIDN-04, respuesta del dueño a la pregunta 10): es un homónimo o un
-- error, y el dueño decide. Una de RE-ENROLAMIENTO es exactamente lo contrario — el RUT TIENE
-- que estar registrado, porque la persona ya trabaja acá y solo cambió de teléfono. Sin una
-- marca en la fila, el mismo hecho —RUT conocido— pediría dos conductas opuestas, y la
-- aprobación tendría que adivinar cuál.
--
-- El §5.4 lo llama flujo de primera clase, no una excepción: se cambia de teléfono seguido, y
-- que eso obligue a pasar de nuevo por una invitación del dueño convierte un trámite de
-- noventa segundos en una llamada telefónica a las cinco de la mañana.
--
-- `persona_id` va con FK compuesta: el re-enrolamiento no propone una persona, RECLAMA una
-- que existe, y su identidad se resolvió contra RUT + PIN antes de crear la fila.

create type tipo_solicitud as enum ('nueva', 'reenrolamiento');

alter table solicitudes_acceso
  add column tipo tipo_solicitud not null default 'nueva',
  add column persona_id uuid;

alter table solicitudes_acceso
  add constraint solicitudes_persona_segun_tipo
    check ((tipo = 'reenrolamiento') = (persona_id is not null)),
  add constraint solicitudes_persona_fk
    foreign key (tenant_id, persona_id) references personas (tenant_id, id);

create index solicitudes_tenant_persona_idx on solicitudes_acceso (tenant_id, persona_id);

comment on column solicitudes_acceso.tipo is
  'nueva = llega por invitación y PROPONE una persona; reenrolamiento = «Ya tengo cuenta» y '
  'RECLAMA una que existe, resuelta contra RUT + PIN antes de crear la fila (AC-FIDN-08).';

-- La invitación deja de ser obligatoria: el re-enrolamiento no pasa por una. Exigirla habría
-- obligado a inventar una invitación fantasma por cada teléfono nuevo — filas que nadie emitió,
-- que aparecerían en el panel del dueño y que habría que explicar.
alter table solicitudes_acceso alter column invitacion_id drop not null;

alter table solicitudes_acceso
  add constraint solicitudes_invitacion_segun_tipo
    check ((tipo = 'nueva') = (invitacion_id is not null));
