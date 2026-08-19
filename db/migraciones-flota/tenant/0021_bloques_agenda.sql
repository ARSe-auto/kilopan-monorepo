-- 0021 — `bloques_agenda`: la agenda vehículo-día del §3.E1.4. [AC-FVEH-07]
--
-- Cuatro tipos, cerrados por el maestro (§4.5): ruta, recarga, mantención y descanso. Es un
-- enum y no texto libre porque de estos cuatro cuelgan conductas distintas —la recarga es la
-- que el tablero «Listos para salir» sugiere a un clic (§5.2-F1), el descanso es el que no
-- puede pisar una ruta— y un quinto tipo inventado en una pantalla sería una conducta que
-- nadie escribió.
--
-- ─── EL SOLAPE LO IMPIDE LA BASE, IGUAL QUE EN `turnos` ─────────────────────────────
--
-- Mismo EXCLUDE y por el mismo motivo (centinela 5, §9.3): un `select` previo es una carrera
-- que dos ediciones simultáneas ganan, y el resultado es un camión con dos cosas agendadas a
-- la misma hora — que en la práctica es un chofer esperando y una entrega que no salió.
--
-- ─── POR QUÉ NO HAY `WHERE` EN ESTE EXCLUDE ────────────────────────────────────────
--
-- El de `turnos` excluye los anulados porque un turno anulado no ocupó el día. Un bloque de
-- agenda no tiene ese estado: se borra. Y se puede borrar —a diferencia de un turno— porque un
-- bloque es un PLAN, no un hecho: nada del §7.4 protege una intención que no se cumplió.

create type bloque_tipo as enum ('ruta', 'recarga', 'mantencion', 'descanso');

create table bloques_agenda (
  id          uuid        not null default uuidv7(),
  tenant_id   uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  vehiculo_id uuid        not null,
  tipo        bloque_tipo not null,
  empieza_en  timestamptz not null,
  termina_en  timestamptz not null,
  nota        text,
  creado_en   timestamptz not null default now(),
  periodo     tstzrange   not null
    generated always as (tstzrange(empieza_en, termina_en)) stored,
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, vehiculo_id) references vehiculos (tenant_id, id),
  constraint bloques_agenda_ventana_valida check (termina_en > empieza_en),
  constraint bloques_agenda_sin_solape exclude using gist (
    tenant_id with =, vehiculo_id with =, periodo with &&
  )
);

-- El índice que la FK compuesta necesita por su cuenta, y que además sirve a la consulta que
-- de verdad hace la pantalla: «los bloques de este vehículo en esta semana».
create index bloques_agenda_tenant_vehiculo_idx
  on bloques_agenda (tenant_id, vehiculo_id, empieza_en);

comment on table bloques_agenda is
  'PLANIFICACIÓN — la agenda por vehículo (§3.E1.4, §4.5). Se edita en web con red y el solape '
  'rebota 422 con 0 filas (centinela 5 §9.3). Un bloque es un PLAN, no un hecho: se borra.';

comment on column bloques_agenda.periodo is
  'Ventana generada de `empieza_en` a `termina_en`. Es la que el EXCLUDE compara: sin ella el '
  'solape habría que buscarlo con un `select` previo, que dos ediciones simultáneas ganan.';

create trigger bloques_agenda_auditar
  after insert or update or delete on bloques_agenda
  for each row execute function auditar();

-- «Duplicar semana» es un acto de planificación con su propio rastro: quien mira la agenda de
-- la semana que viene tiene que poder distinguir lo que alguien planificó a mano de lo que se
-- clonó de la semana anterior (§3.E1.4).
insert into evento_tipo (codigo, descripcion) values
  ('agenda.bloque_creado',    'Se agendó un bloque para un vehículo'),
  ('agenda.bloque_borrado',   'Se sacó un bloque de la agenda de un vehículo'),
  ('agenda.semana_duplicada', 'Se clonaron los bloques reales de la semana anterior');
