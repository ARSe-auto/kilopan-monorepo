-- 0067 — DPA en términos del tenant: la aceptación queda registrada por tenant. [AC-FMIG-22]
--
-- Fuente: §3.E1.15/§7.8 (obligación E1 sin módulo asignado — la asume el hito g, dueño del panel
-- admin white-label) · §4.6 (audit_trail por trigger) · §5.4 (plano de control exclusivo del
-- dueño, 403 con rol distinto de `admin_tenant`).
--
-- EL TEXTO DEL DOCUMENTO NO VIVE ACÁ: `packages/miga/src/dpa.ts` es el artefacto versionado del
-- repo (§0: los valores canónicos viven en su familia, jamás repetidos a mano en dos lugares).
-- Esta tabla graba SOLO el acto — quién aceptó, cuándo, y QUÉ VERSIÓN — igual que
-- `config_version_id` congela qué config vio un turno en vez de dejar que una fila mutable
-- reescriba el pasado.
--
-- MISMO PATRÓN QUE `codigos_puente` (0014): tabla normal en la base del tenant, con el trigger
-- `auditar()` reutilizable enganchado — audit_trail lo escribe SOLO el trigger, y el evento del
-- catálogo lo escribe el acto (`servidor/dpa.ts`), en la MISMA transacción (§4.6, mismo criterio
-- que todo `gobierno.*`).

create table dpa_aceptaciones (
  id           uuid        not null default uuidv7(),
  tenant_id    uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  usuario_id   uuid        not null,
  version      text        not null,
  aceptado_en  timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, usuario_id) references usuarios (tenant_id, id)
);
create index dpa_aceptaciones_tenant_usuario_idx on dpa_aceptaciones (tenant_id, usuario_id);
-- La versión VIGENTE por tenant (§ del AC) es la del `aceptado_en` más reciente: un índice para
-- resolver esa consulta sin escanear la tabla entera a medida que crece.
create index dpa_aceptaciones_tenant_aceptado_en_idx on dpa_aceptaciones (tenant_id, aceptado_en desc);
comment on table dpa_aceptaciones is
  'PLANIFICACIÓN — la aceptación del DPA por el admin_tenant (§3.E1.15, §7.8, AC-FMIG-22). Una '
  'fila por acto de aceptación; la versión vigente del tenant es la de `aceptado_en` más '
  'reciente. El texto que se aceptó vive versionado en `packages/miga/src/dpa.ts`, jamás acá.';

create trigger dpa_aceptaciones_auditar
  after insert or update or delete on dpa_aceptaciones
  for each row execute function auditar();

insert into evento_tipo (codigo, descripcion) values
  ('gobierno.dpa_aceptado', 'El admin_tenant aceptó una versión del DPA en términos del tenant');
