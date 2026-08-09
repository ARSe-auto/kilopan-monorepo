-- 0014 — El plano de control del dueño: código puente y catálogo de eventos. [AC-FIDN-12]
--
-- Dos cosas, y las dos son lo que el panel necesita de la BASE. El resto del gobierno
-- —emitir, pausar, revocar, aprobar, rechazar, revocar aparato, desbloquear— corre sobre las
-- tablas que ya existen (0011–0013): un panel que hubiera necesitado tablas nuevas para eso
-- habría sido la señal de que el esquema del §4.3 estaba incompleto.
--
-- ─── 1. `codigos_puente`: cómo se rota un PIN sin que el dueño lo conozca ──────────────
--
-- La mecánica la fijó Alexis el 09-ago-2026 (Pregunta 2 de esta spec): el dueño emite un
-- CÓDIGO PUENTE de un solo uso, se lo dicta al operario, y el operario lo tipea EN SU aparato
-- enrolado y ahí define el PIN nuevo. La razón es la que hace al PIN servir de algo: si el
-- dueño eligiera el PIN, lo conocería — y una firma por PIN dejaría de probar quién firmó,
-- que es exactamente para lo que existe según el §4.5 del maestro.
--
-- NO LLEVA PLAZO, y es una ausencia deliberada. Ni el maestro ni la respuesta del dueño fijan
-- uno, y un vencimiento inventado sería una respuesta inventada a una pregunta que nadie
-- hizo. El código se acota por los dos ejes que sí están definidos: es de UN SOLO USO, y hay
-- COMO MUCHO UNO VIVO por usuario —emitir otro anula el anterior—. Y sobre todo: el código
-- por sí solo no vale nada. Se canjea desde la sesión del propio operario, o sea desde su
-- aparato enrolado (§4.3: la sesión ES el aparato). Quien escuche el código dictado en un
-- galpón no tiene con qué usarlo. La credencial de verdad sigue siendo el aparato.
--
-- ─── 2. El catálogo de eventos de gobierno ────────────────────────────────────────────
--
-- El §3.E1.14 pide que toda acción de gobierno deje `audit_trail` + evento. El primero lo
-- escriben los triggers de cada tabla desde 0011; el segundo necesita su tipo catalogado
-- (§4.6: el tipo de evento es catálogo, no enum). Se siembran ACÁ, en la plantilla, y no
-- desde la app: un catálogo que la aplicación crea al vuelo es un catálogo donde un código
-- mal escrito nace como código nuevo en vez de ponerse rojo.

create table codigos_puente (
  id          uuid        not null default uuidv7(),
  tenant_id   uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  usuario_id  uuid        not null,
  -- Igual que la invitación (AC-FIDN-03): en la base queda SOLO el hash. Un código que se
  -- pudiera leer de la base sería una vía para fijarle el PIN a cualquiera desde adentro.
  token_hash  text        not null,
  emitido_por uuid        not null,
  usado_en    timestamptz,
  anulado_en  timestamptz,
  creado_en   timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, token_hash),
  foreign key (tenant_id, usuario_id) references usuarios (tenant_id, id),
  foreign key (tenant_id, emitido_por) references usuarios (tenant_id, id),
  -- Un código no puede estar usado Y anulado: son dos desenlaces excluyentes del mismo
  -- objeto, y admitir los dos dejaría sin respuesta «¿el PIN se llegó a cambiar?».
  constraint codigos_puente_un_solo_desenlace check (usado_en is null or anulado_en is null)
);
create index codigos_puente_tenant_usuario_idx on codigos_puente (tenant_id, usuario_id);
-- La segunda FK apunta al MISMO padre por otra columna —quién emitió—, y necesita su propio
-- índice: sin él, dar de baja a un dueño obligaría a un scan completo de esta tabla por cada
-- fila borrada. El linter del §9.2 lo exige y tiene razón; es la clase de costo que no se ve
-- hasta que la tabla tiene años.
create index codigos_puente_tenant_emisor_idx on codigos_puente (tenant_id, emitido_por);
-- COMO MUCHO UNO VIVO POR USUARIO. Parcial, igual que el de «un personal activo por
-- operario»: los usados y los anulados se acumulan porque son la historia de quién pidió qué
-- y cuándo, y un UNIQUE total impediría la segunda rotación de la vida de un operario.
create unique index codigos_puente_uno_vivo_idx
  on codigos_puente (tenant_id, usuario_id)
  where usado_en is null and anulado_en is null;
comment on table codigos_puente is
  'PLANIFICACIÓN — código de un solo uso con que el dueño habilita a un operario a definir '
  'su PIN nuevo en SU aparato (§5.4, Pregunta 2 respondida el 09-ago-2026). El dueño jamás '
  'conoce el PIN: si lo eligiera él, la firma por PIN dejaría de probar quién firmó.';

create trigger codigos_puente_auditar
  after insert or update or delete on codigos_puente
  for each row execute function auditar();

-- ─── Catálogo de eventos del plano de control ────────────────────────────────────────
--
-- Uno por acto de gobierno. La lista es CERRADA y la app resuelve el tipo por código: un
-- código que no esté acá hace fallar la escritura del evento en vez de inventar una fila de
-- catálogo, que es como un panel termina con «invitacion_revoacada» junto a la buena.
insert into evento_tipo (codigo, descripcion) values
  ('gobierno.invitacion_emitida',   'El dueño emitió una invitación de enrolamiento por rol'),
  ('gobierno.invitacion_pausada',   'El dueño pausó una invitación sin mover su vencimiento'),
  ('gobierno.invitacion_reanudada', 'El dueño reanudó una invitación pausada'),
  ('gobierno.invitacion_revocada',  'El dueño anuló una invitación con efecto inmediato'),
  ('gobierno.solicitud_aprobada',   'El dueño aprobó una solicitud de acceso'),
  ('gobierno.solicitud_rechazada',  'El dueño rechazó una solicitud de acceso'),
  ('gobierno.dispositivo_revocado', 'El dueño revocó un aparato enrolado'),
  ('gobierno.puente_emitido',       'El dueño emitió un código puente para que un operario defina su PIN'),
  ('gobierno.pin_definido',         'Un operario definió su PIN nuevo canjeando el código puente'),
  ('gobierno.usuario_desbloqueado', 'El dueño levantó el bloqueo por intentos de PIN de un usuario'),
  ('gobierno.soporte_otorgado',     'El dueño otorgó un grant de soporte con alcance y plazo'),
  ('gobierno.soporte_revocado',     'El dueño revocó un grant de soporte antes de su vencimiento');
