-- 0057 — El dispositivo de andén como activo del tenant, con rotación por PIN [AC-FIDN-07] —
-- §4.3, §5.4 F-D, §4.7 (centinela 9).
--
-- ─── POR QUÉ EL ANDÉN NECESITA UNA TABLA Y EL TELÉFONO PERSONAL NO ───────────────────
--
-- En el personal «la sesión ES el aparato» (AC-FIDN-09): el secreto que el aparato presenta ya
-- dice quién es la persona, porque `dispositivos.persona_id` la nombra. El de andén NO tiene
-- persona dueña —el CHECK `dispositivos_persona_segun_tipo` del 0011 lo hace imposible, y así
-- tiene que ser: es un activo del tenant— así que su secreto identifica al APARATO y a nadie
-- más. Quién está trabajando ahí ahora es un hecho aparte, que cambia varias veces por turno y
-- que solo el PIN puede establecer (§5.4 F-D). Ese hecho es esta tabla.
--
-- ─── UNA FILA POR PAREJA (APARATO, OPERARIO), NO UNA POR ENTRADA ─────────────────────
--
-- La fila se REABRE en cada rotación en vez de acumular una por cada vez que alguien tipea su
-- PIN, y el motivo es el §4.7: `huella` es la partición del outbox de ese operario EN ESTE
-- aparato, y una huella nueva por entrada le dejaría las capturas de la mañana bajo una llave
-- que la tarde ya no mira — el cementerio de capturas que el centinela 9 existe para impedir.
-- Con la fila reusada, el operario que vuelve al mismo andén encuentra su propia cola donde la
-- dejó. El historial de entradas y salidas no se pierde por esto: cada apertura y cada cierre
-- pasa por el trigger de auditoría, que es donde el §3.E1.15 lo va a leer.
--
-- ─── LA HUELLA ES ALEATORIA Y NO DERIVADA ────────────────────────────────────────────
--
-- Podría ser un hash de (aparato, usuario), y sería más corto de escribir. Sería también
-- FORJABLE por cualquiera que conozca esos dos ids: `firmaDelEnrolamiento` (servidor/capturas.ts)
-- atribuye el hecho al aparato y al operario de la huella que viene en el lote, así que una
-- huella adivinable sería una forma de anotarle a un compañero una entrega que no hizo. Se
-- genera con `randomBytes` en el servidor y solo viaja al aparato que rotó.
create table sesiones_anden (
  id             uuid        not null default uuidv7(),
  tenant_id      uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  dispositivo_id uuid        not null,
  usuario_id     uuid        not null,
  -- La partición del outbox de este operario en este aparato (§4.7). 64 hexa, la misma forma que
  -- la huella del enrolamiento personal, para que el lote de sync no tenga que declarar de cuál
  -- de las dos se trata.
  huella         text        not null check (huella ~ '^[0-9a-f]{64}$'),
  abierta_en     timestamptz not null default now(),
  -- El reloj de la inactividad del §0 (`SESION.anden_inactividad_minutos`): lo mueve el servidor
  -- en cada request del aparato, jamás el cliente. El plazo NO se hornea acá — es una cifra
  -- canónica y una segunda copia en el DDL es lo que el gate de constantes impide.
  ultimo_uso_en  timestamptz not null default now(),
  cerrada_en     timestamptz,
  creado_en      timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, dispositivo_id) references dispositivos (tenant_id, id),
  foreign key (tenant_id, usuario_id) references usuarios (tenant_id, id),
  -- Una fila por pareja: la rotación la reabre, no la duplica.
  unique (tenant_id, dispositivo_id, usuario_id),
  -- Cerrada ⇒ no antes de abrirse. Una salida anterior a la entrada haría que la ventana de
  -- inactividad se leyera al revés.
  constraint sesiones_anden_cierre_posterior check (cerrada_en is null or cerrada_en >= abierta_en)
);
-- La huella tiene que resolver a UNA pareja en todo el tenant: es con lo que el motor de sync
-- decide a quién se le anota la captura.
create unique index sesiones_anden_huella_idx on sesiones_anden (tenant_id, huella);
-- UNA identidad abierta por aparato (§5.4 F-D: los operarios ROTAN, no se apilan). Parcial:
-- las cerradas se acumulan porque son la memoria de quién trabajó ahí.
create unique index sesiones_anden_una_abierta_idx
  on sesiones_anden (tenant_id, dispositivo_id)
  where cerrada_en is null;
create index sesiones_anden_tenant_usuario_idx on sesiones_anden (tenant_id, usuario_id);
comment on table sesiones_anden is
  'PLANIFICACIÓN — qué operario está autenticado en cada dispositivo de andén (§5.4 F-D). La '
  'rotación por PIN valida online y rebota 422 tipado; lo que JAMÁS rebota son las capturas que '
  'quedaron en el outbox del operario anterior (§4.7, centinela 9).';

create trigger sesiones_anden_auditar
  after insert or update or delete on sesiones_anden
  for each row execute function auditar();

insert into evento_tipo (codigo, descripcion) values
  ('gobierno.anden_enrolado',
   'El dueño enroló un dispositivo de andén como activo del tenant: sin persona dueña, con '
   'rotación de operarios por PIN (§4.3, §5.4 F-D)'),
  ('anden.identidad_rotada',
   'Otro operario se autenticó por PIN en un dispositivo de andén: se purga SOLO el snapshot y '
   'el outbox del anterior persiste para replayearse (§4.7, centinela 9)');
