-- 0068 — Transferir propiedad con passkey/WebAuthn del admin [AC-FIDN-13] — §5.4 F-H.
--
-- La Pregunta 4 la respondió Alexis el 11-ago-2026: la passkey se registra AL PRIMER USO de
-- «transferir propiedad» —el alta del tenant queda liviana, sin un paso de setup que nadie
-- haría el día 1— y si se pierde se recupera por el break-glass del §7.9, ya aprobado. No
-- nace un secreto de recuperación nuevo que administrar.
--
-- Dos tablas, y las dos son ceremonia — la lógica de verificación (CBOR, COSE, firma ECDSA)
-- vive en TypeScript (`dominio/passkey.ts`) y jamás en la BD: no hay forma razonable de
-- decodificar CBOR en PL/pgSQL, y la BD-como-autoridad del método es sobre REGLAS DE NEGOCIO,
-- no sobre un formato binario de un estándar externo.
--
-- ─── admin_passkeys: la credencial, una por persona que alguna vez fue dueña ───────────
--
-- UNA por usuario (`unique (tenant_id, usuario_id)`), y es la «única passkey del sistema» del
-- §5.4 leída al revés de lo que parece: no es que exista una sola passkey en toda la base,
-- es que WebAuthn no se usa en NINGÚN otro flujo — grep del manifiesto de rutas lo prueba. Que
-- cada admin tenga la SUYA es lo que hace que dos personas que fueron dueñas en momentos
-- distintos no compartan credencial.
--
-- Sobrevive a que su dueño deje de ser `admin_tenant`: si A transfiere a B y B transfiere de
-- vuelta a A, A ya tiene passkey y la ceremonia es `autenticacion` (get), no un registro
-- nuevo — exactamente lo que evita registrar una credencial por cada vaivén.
create table admin_passkeys (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  usuario_id         uuid        not null,
  -- Handle opaco del autenticador, base64url. Global y no por tenant: lo emite el navegador
  -- con entropía criptográfica (RFC 8809 recomienda ≥16 bytes) y una colisión entre tenants
  -- es tan improbable como una entre usuarios del mismo tenant — exigir unicidad total es más
  -- simple que justificar por qué bastaría con menos.
  credential_id      text        not null,
  -- El punto EC P-256 sin comprimir (0x04 ‖ x ‖ y, 65 bytes), tal cual lo necesita
  -- `crypto.subtle.importKey('raw', …)` para verificar la firma — nada de re-armar un COSE_Key
  -- ni un SPKI DER en cada verificación.
  clave_publica_raw  bytea       not null,
  -- El contador anti-clonado del authenticatorData (§6.1 de la spec). Muchos autenticadores de
  -- plataforma lo dejan en 0 para siempre; la verificación en `dominio/passkey.ts` solo exige
  -- que NO retroceda cuando el que llega es distinto de 0 — retroceder ahí sí es la señal de
  -- una credencial clonada.
  contador           bigint      not null default 0,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, usuario_id),
  unique (credential_id),
  foreign key (tenant_id, usuario_id) references usuarios (tenant_id, id),
  constraint admin_passkeys_contador_no_negativo check (contador >= 0)
);
create index admin_passkeys_tenant_usuario_idx on admin_passkeys (tenant_id, usuario_id);
comment on table admin_passkeys is
  'PLANIFICACIÓN — la passkey/WebAuthn del admin, registrada al primer uso de «transferir '
  'propiedad» (§5.4 F-H, Pregunta 4 respondida el 11-ago-2026). ÚNICO lugar del sistema donde '
  'WebAuthn se usa — prohibido en cualquier otro flujo.';

create trigger admin_passkeys_auditar
  after insert or update or delete on admin_passkeys
  for each row execute function auditar();

-- ─── retos_webauthn: el desafío de la ceremonia, de un solo uso y de vida corta ────────
--
-- Sin esto, el servidor no tiene con qué comparar el `challenge` que vuelve firmado ni con qué
-- fijar, DESDE que se emiten las opciones, a quién se transfiere — fijarlo recién al confirmar
-- dejaría una ventana donde el cuerpo del segundo request podría apuntar a otro destino que la
-- ceremonia jamás autorizó.
--
-- NO LLEVA GRACIA LARGA a propósito: 5 minutos (`PASSKEY.reto_vigencia_min` en
-- `dominio/passkey.ts`) alcanzan de sobra para una huella dactilar y acotan la ventana de un
-- reto que alguien interceptó sin usar.
create table retos_webauthn (
  id                     uuid        not null default uuidv7(),
  tenant_id              uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  usuario_id             uuid        not null,
  tipo                   text        not null check (tipo in ('registro', 'autenticacion')),
  reto                   text        not null,
  nuevo_admin_usuario_id uuid        not null,
  usado_en               timestamptz,
  expira_at              timestamptz not null,
  creado_en              timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, usuario_id) references usuarios (tenant_id, id),
  foreign key (tenant_id, nuevo_admin_usuario_id) references usuarios (tenant_id, id)
);
create index retos_webauthn_tenant_usuario_idx on retos_webauthn (tenant_id, usuario_id);
-- La segunda FK apunta al MISMO padre por otra columna — misma lección de `codigos_puente`
-- (0014): dos FK al mismo padre por columnas distintas necesitan dos índices, o el linter del
-- §9.2 lo frena.
create index retos_webauthn_tenant_nuevo_admin_idx on retos_webauthn (tenant_id, nuevo_admin_usuario_id);
comment on table retos_webauthn is
  'PLANIFICACIÓN — el desafío de una ceremonia WebAuthn en curso, de un solo uso y ~5 minutos '
  'de vida (§5.4 F-H) [AC-FIDN-13]. Fija el destino de la transferencia DESDE que se emiten '
  'las opciones, no al confirmar.';

-- ─── Catálogo de eventos de la ceremonia ───────────────────────────────────────────────
insert into evento_tipo (codigo, descripcion) values
  ('gobierno.passkey_registrada',     'Un admin registró su passkey al primer uso de «transferir propiedad»'),
  ('gobierno.propiedad_transferida',  'La propiedad del tenant se transfirió a un nuevo admin_tenant');
