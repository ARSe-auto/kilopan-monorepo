-- 0011 — Identidad, roles y enrolamiento (§4.3). Hito §9.1(4)(b). [AC-FIDN-01]
--
-- Lo que este archivo trae: el ESQUEMA del módulo 01 en `tenant_template` — personas,
-- usuarios, invitaciones, solicitudes_acceso, dispositivos, firmas y retention_policy —
-- con sus enums cerrados, la clase de la regla de oro (§4.2) y el append-only del §7.4.
--
-- Lo que NO trae, a propósito: ninguna CONDUCTA. La invitación que da derecho a solicitar y
-- jamás a entrar (AC-FIDN-03), la aprobación en 1 toque que emite el secreto UNA vez
-- (AC-FIDN-04), el lockout con su backoff (AC-FIDN-06) y la revocación con cuarentena
-- (AC-FIDN-08) son ACs propios. Acá está la forma; el comportamiento tiene su commit.
--
-- Y no trae NINGÚN plazo. `retention_policy` nace vacía y con la purga apagada por
-- construcción: los plazos son la Pregunta 8 al dueño, y una tabla de retención con valores
-- inventados es peor que una vacía — la primera borra datos que nadie autorizó a borrar.
--
-- CLASE (§4.2): todo PLANIFICACIÓN —valida online y rebota 422— EXCEPTO `firmas`, que es
-- CAPTURA: la firma por PIN ocurre en terreno (custodia F2, POD F4) y jamás rebota al
-- sincronizar.

-- ─── RUT: módulo 11, en la BD y no solo en la app ────────────────────────────────────
--
-- El §0 fija el formato `12.345.678-5` y la validación por módulo 11. Va como CHECK y no
-- solo como validación de formulario porque un RUT inválido que entra por un script, una
-- carga masiva o un endpoint futuro es igual de inválido, y la BD es la autoridad sobre las
-- reglas de negocio. La app valida AL ESCRIBIR (§4.3) para que la persona lo vea antes de
-- enviar; esto es la red de abajo, no su reemplazo.
create or replace function rut_valido(p_rut text) returns boolean
  language plpgsql immutable strict as $$
  declare
    v_cuerpo    text;
    v_dv        text;
    v_esperado  text;
    v_suma      int := 0;
    v_factor    int := 2;
    v_resto     int;
    i           int;
  begin
    -- El formato canónico EXACTO del §0: con puntos de miles y guion. Aceptar además la
    -- forma pelada haría que la base guardara dos representaciones del mismo RUT y que
    -- `unique (tenant_id, rut)` dejara de significar «una persona».
    if p_rut !~ '^\d{1,3}(\.\d{3})+-[\dkK]$' then
      return false;
    end if;

    v_cuerpo := replace(split_part(p_rut, '-', 1), '.', '');
    v_dv := lower(split_part(p_rut, '-', 2));

    for i in reverse length(v_cuerpo)..1 loop
      v_suma := v_suma + substr(v_cuerpo, i, 1)::int * v_factor;
      v_factor := case when v_factor = 7 then 2 else v_factor + 1 end;
    end loop;

    v_resto := 11 - (v_suma % 11);
    v_esperado := case v_resto when 11 then '0' when 10 then 'k' else v_resto::text end;
    return v_dv = v_esperado;
  end
  $$;

comment on function rut_valido(text) is
  'Módulo 11 sobre el formato canónico del §0 (12.345.678-5). CHECK de personas.rut.';

-- ─── Enums cerrados (§0, §4.3) ───────────────────────────────────────────────────────
--
-- El enum de roles es FIJO: los packs de vertical agregan campos y catálogos (§4.9), jamás
-- roles. Es un tipo de la BD y no una tabla justamente para que agregar uno sea una
-- migración visible y no un INSERT de madrugada. Su lista es la del canónico §0
-- (`ROLES` en packages/nucleo-comun/src/constants.ts) y una prueba la compara valor a valor:
-- dos listas iguales escritas en dos lugares se separan el día que alguien toca una sola.
create type rol_usuario as enum (
  'admin_tenant', 'operador', 'chofer', 'responsable_carga', 'responsable_tecnico', 'cliente'
);

-- Personal (de una persona, uno activo a la vez) o de andén (activo del tenant, sin persona
-- dueña, con rotación por PIN). §4.3, §5.4 F-D.
create type tipo_dispositivo as enum ('personal', 'anden');

create type estado_solicitud as enum ('pendiente', 'aprobada', 'rechazada');

-- Qué SIGNIFICA la firma. Cerrado porque una firma sin significado no sirve de prueba: en la
-- custodia multi-empresa (§4.5 F2) la diferencia entre «recibí conforme» y «liberé» es la
-- diferencia entre quién responde por la carga.
create type significado_firma as enum (
  'recibio_conforme', 'libero', 'rechazo', 'verifico', 'aprobo'
);

-- ─── personas: los identificadores, separados de todo hecho ──────────────────────────
--
-- La separación es del §7.8: los hechos referencian un ID opaco y los datos personales viven
-- SOLO acá, para que la supresión de la Ley 21.719 sea anonimizar UNA fila sin tocar el
-- ledger append-only — que no se puede tocar (§7.4) y que además no debe: borrar la historia
-- operativa para cumplir una solicitud de supresión sería destruir prueba de entregas.
create table personas (
  id             uuid        not null default uuidv7(),
  tenant_id      uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  rut            text,
  nombre         text,
  contacto       text,
  anonimizada_en timestamptz,
  creada_en      timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, rut),
  -- La anonimización es completa o no es, y por eso es un CHECK y no una convención. Una fila
  -- «anonimizada» que conserva el RUT no está anonimizada: es una fila con una fecha puesta.
  -- Al revés, una persona viva sin RUT ni nombre no se puede volver a identificar y rompe el
  -- UNIQUE por tenant. El invariante hace imposibles las dos.
  constraint personas_anonimizacion_completa check (
    (anonimizada_en is null and rut is not null and nombre is not null)
    or (anonimizada_en is not null and rut is null and nombre is null and contacto is null)
  ),
  constraint personas_rut_modulo_11 check (rut is null or rut_valido(rut))
);
create index personas_tenant_rut_idx on personas (tenant_id, rut);
comment on table personas is
  'PLANIFICACIÓN — identificadores de personas naturales, separados de los hechos (§7.8). '
  'La supresión de la 21.719 anonimiza esta fila; el ledger no se toca.';

-- ─── usuarios: rol y credencial de la persona dentro del tenant ──────────────────────
create table usuarios (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  persona_id         uuid        not null,
  rol                rol_usuario not null,
  -- Sin FK: `empresas_cliente` del §4.5 nace en el módulo de encargos. ALCANCE DECLARADO, no
  -- olvido — la FK compuesta se agrega en la migración de ese módulo, que es cuando existe
  -- la tabla a la que apuntar. El CHECK que el §4.3 exige sí está desde hoy.
  empresa_cliente_id uuid,
  pin_hash           text,
  intentos_fallidos  int         not null default 0,
  bloqueado_hasta    timestamptz,
  activo             boolean     not null default true,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, persona_id) references personas (tenant_id, id),
  -- El mapeo cerrado del §4.3: contratante = `cliente` con su empresa SIEMPRE. Un usuario
  -- `cliente` sin empresa vería el portal de nadie, y el portal filtra por esa columna.
  constraint usuarios_cliente_con_empresa check (
    (rol = 'cliente') = (empresa_cliente_id is not null)
  ),
  constraint usuarios_intentos_no_negativos check (intentos_fallidos >= 0)
);
create index usuarios_tenant_persona_idx on usuarios (tenant_id, persona_id);
create index usuarios_tenant_rol_idx on usuarios (tenant_id, rol);
comment on table usuarios is
  'PLANIFICACIÓN — rol y credencial de PIN por persona. El rol es enum FIJO del §0: los '
  'packs de vertical jamás crean roles.';

create trigger usuarios_auditar
  after insert or update or delete on usuarios
  for each row execute function auditar();

-- ─── invitaciones: dan derecho a SOLICITAR, jamás a entrar ───────────────────────────
create table invitaciones (
  id          uuid        not null default uuidv7(),
  tenant_id   uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  rol         rol_usuario not null,
  token_hash  text        not null,
  -- El plazo lo pone quien emite, con la constante del §0 (`INVITACION.expira_dias`): acá no
  -- hay DEFAULT con el número horneado. Escribirlo también en el DDL sería la segunda copia
  -- de una cifra canónica, que es exactamente lo que el gate de constantes existe para
  -- impedir — y la copia que se queda vieja es siempre la que nadie mira.
  expira_at   timestamptz not null,
  -- Pausa REANUDABLE que no altera `expira_at` (§5.4): una marca de tiempo nullable es
  -- exactamente eso. Con un enum de estado habría que decidir qué pasa al reanudar una
  -- vencida, y la respuesta ya está: vence igual, porque la pausa nunca movió la fecha.
  pausada_at  timestamptz,
  revocada_at timestamptz,
  creada_por  uuid        not null,
  creada_en   timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, token_hash),
  foreign key (tenant_id, creada_por) references usuarios (tenant_id, id)
);
create index invitaciones_tenant_creada_por_idx on invitaciones (tenant_id, creada_por);
create index invitaciones_tenant_expira_idx on invitaciones (tenant_id, expira_at);
comment on table invitaciones is
  'PLANIFICACIÓN — invitación por rol, multi-uso. Da derecho a SOLICITAR, jamás a entrar: '
  'quien la usa crea una solicitud pendiente y espera la aprobación del dueño (§4.3).';

create trigger invitaciones_auditar
  after insert or update or delete on invitaciones
  for each row execute function auditar();

-- ─── solicitudes_acceso: la persona PROPUESTA, todavía no la persona ─────────────────
--
-- Los datos viajan acá y NO en `personas` hasta que el dueño aprueba. Crear la persona al
-- solicitar dejaría que cualquiera con el link sembrara filas de identidad en el tenant —y
-- consumiera el UNIQUE del RUT— sin que nadie lo autorizara.
create table solicitudes_acceso (
  id                  uuid             not null default uuidv7(),
  tenant_id           uuid             not null default tenant_actual() check (tenant_id = tenant_actual()),
  invitacion_id       uuid             not null,
  rut_propuesto       text             not null,
  nombre_propuesto    text             not null,
  pin_hash            text             not null,
  -- La huella pública del aparato: contra esta clave se cifra el secreto que se emite UNA
  -- vez al aprobar (§4.3, AC-FIDN-04). Sin ella, la aprobación no tendría a quién emitirle.
  clave_publica       text             not null,
  huella_dispositivo  text             not null,
  estado              estado_solicitud not null default 'pendiente',
  resuelta_por        uuid,
  resuelta_en         timestamptz,
  creada_en           timestamptz      not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, invitacion_id) references invitaciones (tenant_id, id),
  foreign key (tenant_id, resuelta_por) references usuarios (tenant_id, id),
  constraint solicitudes_rut_modulo_11 check (rut_valido(rut_propuesto)),
  -- Una solicitud resuelta sin quién ni cuándo no es auditable, que es la mitad del punto de
  -- que la aprobación sea un acto de gobierno (§3.E1.14).
  constraint solicitudes_resolucion_completa check (
    (estado = 'pendiente') = (resuelta_por is null and resuelta_en is null)
  )
);
create index solicitudes_tenant_invitacion_idx on solicitudes_acceso (tenant_id, invitacion_id);
create index solicitudes_tenant_resuelta_por_idx on solicitudes_acceso (tenant_id, resuelta_por);
create index solicitudes_tenant_estado_idx on solicitudes_acceso (tenant_id, estado);
comment on table solicitudes_acceso is
  'PLANIFICACIÓN — solicitud de acceso con la persona PROPUESTA y la clave pública del '
  'aparato. La aprobación empareja persona+dispositivo+rol y recién ahí emite el secreto.';

create trigger solicitudes_acceso_auditar
  after insert or update or delete on solicitudes_acceso
  for each row execute function auditar();

-- ─── dispositivos: personal o de andén, con revocación soft ──────────────────────────
create table dispositivos (
  id                uuid             not null default uuidv7(),
  tenant_id         uuid             not null default tenant_actual() check (tenant_id = tenant_actual()),
  tipo              tipo_dispositivo not null,
  -- Nullable porque el de andén es activo del TENANT y no tiene persona dueña (§4.3, F-D).
  persona_id        uuid,
  -- El secreto se emite UNA vez contra la clave pública; en la BD queda solo su hash. La
  -- extensión del §4.3 que esto sostiene es que el secreto jamás aparece en un log.
  secreto_hash      text,
  -- El enrolamiento NO se completa sin las dos (§4.3, corrección del adversario): sin
  -- standalone la PWA no es la app, y sin persist() el navegador puede evictar el outbox —
  -- o sea, perder capturas del terreno. La CONDUCTA es AC-FIDN-05; acá viven las columnas.
  is_standalone     boolean          not null default false,
  storage_persisted boolean          not null default false,
  enrolado_por      uuid,
  enrolado_en       timestamptz,
  revocado_at       timestamptz,
  creado_en         timestamptz      not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, persona_id) references personas (tenant_id, id),
  foreign key (tenant_id, enrolado_por) references usuarios (tenant_id, id),
  -- Personal ⇒ tiene dueña. Andén ⇒ no la tiene. Sin esto, un aparato de andén con persona
  -- dueña entraría al índice de «un personal activo por operario» y bloquearía su teléfono.
  constraint dispositivos_persona_segun_tipo check (
    (tipo = 'personal') = (persona_id is not null)
  )
);
create index dispositivos_tenant_persona_idx on dispositivos (tenant_id, persona_id);
create index dispositivos_tenant_enrolado_por_idx on dispositivos (tenant_id, enrolado_por);
-- UN dispositivo personal activo por operario (§4.3). Parcial y no total: los revocados se
-- acumulan —revocación es SOFT, la historia no se borra— y un UNIQUE total impediría el
-- re-enrolamiento por teléfono nuevo, que es un flujo de primera clase (F-E).
create unique index dispositivos_uno_personal_activo_idx
  on dispositivos (tenant_id, persona_id)
  where tipo = 'personal' and revocado_at is null;
comment on table dispositivos is
  'PLANIFICACIÓN — aparatos enrolados, personales o de andén. Revocación soft con efecto '
  'inmediato: las capturas posteriores entran igual, con flag (§4.3, centinela 4).';

create trigger dispositivos_auditar
  after insert or update or delete on dispositivos
  for each row execute function auditar();

-- ─── firmas: la única tabla CAPTURA de este módulo ───────────────────────────────────
--
-- Append-only por las dos capas del §7.4, igual que los hechos del 0002: el REVOKE al rol de
-- app (que `db/flota/rol-app.mjs` DERIVA de este mismo trigger, sin lista a mano) y el
-- trigger, que detiene también a quien tenga más privilegios. Los dos responden 42501.
create table firmas (
  id             uuid              not null default uuidv7(),
  tenant_id      uuid              not null default tenant_actual() check (tenant_id = tenant_actual()),
  persona_id     uuid              not null,
  dispositivo_id uuid              not null,
  objeto_tabla   text              not null,
  objeto_id      uuid              not null,
  significado    significado_firma not null,
  ts_servidor    timestamptz       not null default now(),
  client_uuid    uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Idempotencia del replay offline (§0, §4.7): el segundo envío de la misma firma no crea
  -- una segunda fila. Es el centinela 1 del §9.3 aplicado a esta tabla.
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, persona_id) references personas (tenant_id, id),
  foreign key (tenant_id, dispositivo_id) references dispositivos (tenant_id, id)
);
create index firmas_tenant_persona_idx on firmas (tenant_id, persona_id);
create index firmas_tenant_dispositivo_idx on firmas (tenant_id, dispositivo_id);
create index firmas_tenant_objeto_idx on firmas (tenant_id, objeto_tabla, objeto_id);
comment on table firmas is
  'CAPTURA — firmas por PIN en terreno. Entran siempre y jamás rebotan al sincronizar; la '
  'firma en aparato ajeno no abre sesión ni desplaza la propia (§4.3, centinela 12).';

create trigger firmas_append_only
  before update or delete on firmas
  for each row execute function rechazar_mutacion_de_hecho();
create trigger firmas_append_only_truncate
  before truncate on firmas
  for each statement execute function rechazar_mutacion_de_hecho();

-- ─── retention_policy: la tabla nace, la purga NO ────────────────────────────────────
--
-- El §3.E1.15 manda crear la tabla en E1 y no fija plazos: son la Pregunta 8 al dueño. Se
-- crea vacía y con la purga apagada POR CONSTRUCCIÓN — un CHECK, no una promesa: una
-- política activa sin plazo no se puede insertar. Así, el día que lleguen los valores, el
-- cambio es un UPDATE y no una migración de emergencia; y hasta entonces no hay forma de
-- que una purga se encienda por accidente y borre lo que nadie autorizó a borrar.
create table retention_policy (
  id         uuid        not null default uuidv7(),
  tenant_id  uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  registro   text        not null,
  plazo_dias int,
  activa     boolean     not null default false,
  nota       text,
  creada_en  timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, registro),
  constraint retention_policy_sin_plazo_no_purga check (not activa or plazo_dias is not null),
  constraint retention_policy_plazo_positivo check (plazo_dias is null or plazo_dias > 0),
  -- El §7.4 gana sobre cualquier plazo: de lo append-only no se purga NADA, y por eso la
  -- lista de registros purgables es cerrada y no incluye hechos, evidencia ni auditoría.
  constraint retention_policy_registro_purgable check (
    registro in ('invitaciones_vencidas', 'solicitudes_rechazadas', 'dispositivos_revocados',
                 'grants_expirados')
  )
);
create index retention_policy_tenant_registro_idx on retention_policy (tenant_id, registro);
comment on table retention_policy is
  'PLANIFICACIÓN — plazos de retención de la 21.719. Nace vacía: los plazos son la Pregunta '
  '8 al dueño y ninguna purga se activa sin ellos (§3.E1.15, §7.4).';

create trigger retention_policy_auditar
  after insert or update or delete on retention_policy
  for each row execute function auditar();

create trigger personas_auditar
  after insert or update or delete on personas
  for each row execute function auditar();
