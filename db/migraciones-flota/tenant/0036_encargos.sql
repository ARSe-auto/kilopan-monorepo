-- 0036 — `empresas_cliente`, `destinos` y `encargos`: el alta de la bandeja. [AC-FRUT-01]
--
-- Primera migración del módulo 03 (hito d). El §3.E1.5 pide el alta en menos de diez segundos
-- con tres datos: empresa, destino y bultos. Todo lo demás es progresivo o tiene default.
--
-- ─── EL ENUM DE ESTADOS NACE CON DOS VALORES, Y ES A PROPÓSITO ─────────────────────
--
-- La **pregunta 1** de la spec 03 está abierta: el maestro fija `solicitado` (§4.5), «finales
-- solo-por-trigger» y «editable solo hasta aceptación» (§3.E1.10), pero NO enumera los estados
-- intermedios ni cuáles son exactamente los finales. Inventarlos acá sería responder por el
-- dueño la pregunta que su propia spec declara abierta — y con un enum, además, sería una
-- respuesta cara de corregir.
--
-- Los dos que sí salen del texto, literales:
--   · `solicitado` — el §4.5 lo nombra: así nace el encargo que crea el rol `cliente`.
--   · `aceptado`   — el §3.E1.10 dice «editable solo hasta la ACEPTACIÓN del operador», y un
--     encargo que crea el propio operador ya pasó por él. No es un nombre nuevo: es el otro
--     lado de la única transición que el maestro sí nombra.
--
-- La máquina completa —intermedios, finales y el trigger que estampa los finales— es
-- AC-FRUT-03, y agregará sus valores con `ALTER TYPE … ADD VALUE` cuando el dueño responda.
--
-- ─── `destinos` CON CAJA DE CHILE ──────────────────────────────────────────────────
--
-- El §4.5 pide `lat/lng NULL CHECK Chile`. La caja es la del país continental más sus islas
-- oceánicas y el territorio austral: cualquier punto fuera es un error de digitación o de
-- geocoding, y una entrega planificada contra una coordenada equivocada es un camión que sale.
-- `geo_confianza` lleva el enum COMPLETO aunque E1 solo produzca dos valores (§3.E2).

create table empresas_cliente (
  id                uuid        not null default uuidv7(),
  tenant_id         uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  rut               text        not null,
  razon_social      text        not null,
  direccion_retiro  text,
  contacto          text,
  activa            boolean     not null default true,
  creada_en         timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, rut),
  constraint empresas_cliente_razon_social_no_vacia check (length(btrim(razon_social)) > 0)
);
create index empresas_cliente_tenant_activa_idx on empresas_cliente (tenant_id, activa, razon_social);

comment on table empresas_cliente is
  'PLANIFICACIÓN — las empresas contratantes del tenant (§4.5). En modo `mi_flota` existe UNA '
  'implícita. El RUT es único por tenant: dos filas para la misma empresa parten su historia.';

create type geo_confianza as enum ('rooftop', 'interpolado', 'manual', 'sin_geo');

-- pii: exenta destinos.direccion_del_local — es la dirección de un LOCAL de entrega (una
-- panadería, una bodega), jamás la de una persona. El §7.8 protege los identificadores de
-- PERSONAS, que viven en `personas` y se referencian por id opaco para que la supresión de la
-- Ley 21.719 sea anonimizar una fila sin tocar el ledger append-only. El gate sospecha de la
-- palabra «dirección» con razón —en una base que guarda personas, es la columna por la que la
-- dirección particular de alguien termina donde la supresión no llega— y por eso la columna
-- lleva el nombre completo: sin él, la próxima persona tendría que decidir de nuevo si puede
-- escribir ahí la dirección de un cliente final. El nombre lo contesta solo; la exención lo
-- deja contado.

create table destinos (
  id             uuid          not null default uuidv7(),
  tenant_id      uuid          not null default tenant_actual() check (tenant_id = tenant_actual()),
  nombre         text          not null,
  -- `direccion_del_local` y no `direccion` a secas: el gate de PII estructural (§7.8) sospecha
  -- de esa palabra con razón —en una base que guarda personas, «dirección» es la columna por la
  -- que la dirección particular de alguien termina en una tabla donde la supresión de la Ley
  -- 21.719 no puede llegar—. Acá es la de un LOCAL de entrega, y el §4.5 ni siquiera fija el
  -- nombre de esta columna. El nombre lo contesta solo, para que nadie tenga que decidirlo otra vez.
  direccion_del_local text,
  comuna         text,
  lat            numeric(9, 6),
  lng            numeric(9, 6),
  -- En E1 solo se producen `manual` y `sin_geo`: el geocoding es E2 (§3.E2). El enum va
  -- completo porque es del §4.5 y agregarle un valor después es un ALTER TYPE en producción.
  geo_confianza  geo_confianza not null default 'sin_geo',
  pin_confirmado boolean       not null default false,
  notas_acceso   text,
  primary key (id),
  unique (tenant_id, id),
  constraint destinos_nombre_no_vacio check (length(btrim(nombre)) > 0),
  -- La caja de Chile (§4.5). Un punto fuera es un error de digitación, y una entrega
  -- planificada contra una coordenada equivocada es un camión que sale para el lado contrario.
  constraint destinos_dentro_de_chile check (
    (lat is null and lng is null)
    or (lat between -56.0 and -17.0 and lng between -110.0 and -66.0)
  ),
  -- Las dos juntas o ninguna: media coordenada no ubica nada y se lee como un dato cargado.
  constraint destinos_coordenada_completa check ((lat is null) = (lng is null))
);
create index destinos_tenant_nombre_idx on destinos (tenant_id, nombre);

comment on table destinos is
  'PLANIFICACIÓN — a dónde va un encargo (§4.5). Coordenadas opcionales y acotadas a Chile; '
  'en E1 `geo_confianza` solo llega a `manual` o `sin_geo` porque el geocoding es E2.';

/** Los dos estados que el maestro fija literalmente. El resto los agrega AC-FRUT-03 cuando el
 *  dueño responda la pregunta 1 de la spec 03. */
create type encargo_estado as enum ('solicitado', 'aceptado');

create table encargos (
  id                uuid           not null default uuidv7(),
  tenant_id         uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  empresa_cliente_id uuid          not null,
  destino_id        uuid           not null,
  cargo_type_id     uuid,
  -- Registro de atributos TIPADO del §4.9: validado por trigger contra la definición vigente.
  -- Ni tablas satélite por vertical ni jsonb libre.
  attrs             jsonb          not null default '{}'::jsonb,
  bultos            int            not null,
  fecha_servicio    date           not null default (now() at time zone 'America/Santiago')::date,
  estado            encargo_estado not null default 'aceptado',
  -- Reintento = encargo NUEVO que apunta al original (§4.5, patrón OptimoRoute del §6): la
  -- historia completa se conserva, y por eso no se edita el original ni se le cambia el estado.
  reintento_de      uuid,
  detalle_externo   jsonb          not null default '{}'::jsonb,
  client_uuid       uuid,
  creado_en         timestamptz    not null default now(),
  primary key (id),
  unique (tenant_id, id),
  -- Idempotencia del alta por importación y del replay del outbox (centinela 1 §9.3).
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  foreign key (tenant_id, destino_id) references destinos (tenant_id, id),
  foreign key (tenant_id, cargo_type_id) references cargo_type (tenant_id, id),
  foreign key (tenant_id, reintento_de) references encargos (tenant_id, id),
  -- El rango del §4.5, literal. Un cero no es un encargo y quinientos y uno es un camión.
  constraint encargos_bultos_en_rango check (bultos between 1 and 500)
);
create index encargos_tenant_fecha_idx on encargos (tenant_id, fecha_servicio desc, estado);
create index encargos_tenant_empresa_idx on encargos (tenant_id, empresa_cliente_id);
create index encargos_tenant_destino_idx on encargos (tenant_id, destino_id);
create index encargos_tenant_cargo_type_idx on encargos (tenant_id, cargo_type_id);
create index encargos_tenant_reintento_idx on encargos (tenant_id, reintento_de);

comment on table encargos is
  'PLANIFICACIÓN — el encargo de la bandeja (§4.5, §3.E1.5). Alta en <10 s con empresa, '
  'destino y bultos; el resto tiene default. Rebota 422 con 0 filas ante bultos fuera de '
  'rango o `attrs` que no cumpla su definición vigente (§4.2, §4.9).';

comment on column encargos.estado is
  'Los DOS estados que el maestro fija (§4.5, §3.E1.10). Los intermedios y los finales los '
  'agrega AC-FRUT-03 cuando el dueño responda la pregunta 1 de la spec 03.';

-- La validación de `attrs` contra la definición VIGENTE (§4.9), con el trigger que la 0006
-- dejó listo para engancharse con una línea. Sin esto, `attrs` sería el jsonb libre que el
-- §4.9 prohíbe con todas las letras.
create trigger encargos_attrs
  before insert or update on encargos
  for each row execute function validar_attrs('encargos');

create trigger encargos_auditar
  after insert or update or delete on encargos
  for each row execute function auditar();

insert into evento_tipo (codigo, descripcion) values
  ('encargo.creado', 'Se dio de alta un encargo en la bandeja');
