-- 0039 — La empresa implícita del modo `mi_flota`. [AC-FRUT-14]
--
-- El §3 fija el selector de modo y el §4.5 su consecuencia: «en modo `mi_flota` existe UNA
-- empresa_cliente implícita (= la propia, creada por trigger)». El módulo 00 delegó ese trigger
-- explícitamente al módulo que crea la tabla, y la tabla la creó AC-FRUT-01.
--
-- ─── POR QUÉ LA EMPRESA IMPLÍCITA TIENE QUE EXISTIR DE VERDAD ──────────────────────
--
-- Podría no existir: en `mi_flota` la empresa contratante es la propia, así que los encargos
-- podrían llevar `empresa_cliente_id` en NULL y la UI no mostrar nada. Eso sería más corto hoy y
-- carísimo después — cada consulta de manifiesto, de cierre y de liquidación tendría dos formas,
-- una con empresa y otra sin ella, y la segunda es la que nadie prueba.
--
-- La fila existe, la UI no la muestra (navegación contraída, §3, §5.5), y todo el módulo opera
-- igual en los dos modos. Conmutar es entonces cambiar qué se muestra, no qué se guarda.
--
-- ─── POR QUÉ EL MODO TIENE QUE ESTAR EN ESTA BASE ─────────────────────────────────
--
-- `control.tenants.modo` es la autoridad, pero vive en OTRA base y el §7.2 prohíbe que una
-- consulta del tenant la cruce. Un trigger que necesita saber el modo tiene que poder leerlo acá.
-- Por eso `tenant_info` gana `modo`: es una RÉPLICA de la decisión, no una segunda autoridad — la
-- escribe quien conmuta, en el mismo acto.
--
-- Con ella vienen `rut_de_la_empresa` y `razon_social`: son la identidad de la empresa dueña de la
-- cuenta, y sin ellas la empresa implícita no se puede crear (su RUT es único y obligatorio,
-- §4.5). Hoy las siembra el provisionador; en producción las llenará el wizard (AC-FMIG-14).
--
-- pii: exenta tenant_info.rut_de_la_empresa — es el RUT de la PERSONA JURÍDICA dueña de la
-- cuenta, la misma que ya vive en `empresas_cliente.rut` y que el §4.5 pone ahí sin rodeos. El
-- §7.8 protege los identificadores de PERSONAS NATURALES, que viven en `personas` y se
-- referencian por id opaco para que la supresión de la Ley 21.719 sea anonimizar una fila sin
-- tocar el ledger append-only — y una empresa no ejerce ese derecho: no es una persona. El gate
-- sospecha de la palabra «rut» con razón, porque es por donde el RUT de un trabajador termina
-- donde la supresión no llega, y por eso la columna lleva el nombre completo: sin él, la próxima
-- persona tendría que decidir de nuevo si puede escribir ahí el RUT de alguien. El nombre lo
-- contesta solo; la exención lo deja contado.
--
-- ─── CONMUTAR ES ADITIVO, JAMÁS DESTRUCTIVO (centinela 11) ────────────────────────
--
-- Pasar a `daas` NO borra la empresa implícita ni sus encargos: solo deja de ser la única.
-- Volver a `mi_flota` no la crea de nuevo —ya está— ni toca las contratantes que se dieron de
-- alta mientras tanto. El trigger es idempotente por construcción, que es lo que hace que
-- `mi_flota → daas → mi_flota` no pierda una fila.

alter table tenant_info add column if not exists modo         text not null default 'mi_flota';
alter table tenant_info add column if not exists rut_de_la_empresa text;
alter table tenant_info add column if not exists razon_social      text;

alter table tenant_info drop constraint if exists tenant_info_modo_conocido;
alter table tenant_info add constraint tenant_info_modo_conocido
  check (modo in ('mi_flota', 'daas'));

comment on column tenant_info.modo is
  'RÉPLICA de `control.tenants.modo` (§3). La autoridad es `control`; acá vive para que un '
  'trigger del tenant pueda leerla sin cruzar bases (§7.2). La escribe quien conmuta.';

-- Cuál de las contratantes es la propia. Sin esta marca, «la empresa implícita» sería una
-- convención sobre el RUT, y la primera contratante con el mismo RUT la rompería.
alter table empresas_cliente add column if not exists implicita boolean not null default false;

-- UNA sola implícita por tenant. Es la mitad que el trigger no puede garantizar solo: dos altas
-- concurrentes al conmutar encontrarían la tabla sin ella las dos.
create unique index if not exists empresas_cliente_una_implicita
  on empresas_cliente (tenant_id) where implicita;

comment on column empresas_cliente.implicita is
  'La propia empresa, en modo `mi_flota` (§4.5). La UI no la muestra (navegación contraída, '
  '§5.5) pero encargos, manifiestos y cierres operan contra ella igual que en `daas`.';

/**
 * Crea la empresa implícita cuando el tenant está en `mi_flota` y ya sabe quién es.
 *
 * Idempotente a propósito, y es lo que hace cierto el centinela 11: se dispara al sembrar
 * `tenant_info` y en cada conmutación, y `on conflict do nothing` hace que volver a `mi_flota` no
 * cree una segunda ni pise la que hay.
 *
 * Si falta el RUT o la razón social no hace nada y no rebota: el tenant existe antes de que el
 * wizard termine de llenarlo, y rebotar acá dejaría una base a medio provisionar. La fila aparece
 * en cuanto los datos lleguen, porque el trigger también corre en UPDATE.
 */
create or replace function crear_empresa_implicita() returns trigger
  language plpgsql as $$
  begin
    if new.modo <> 'mi_flota' then return new; end if;
    if new.rut_de_la_empresa is null or new.razon_social is null then return new; end if;

    insert into empresas_cliente (rut, razon_social, implicita)
    values (new.rut_de_la_empresa, new.razon_social, true)
      on conflict do nothing;

    return new;
  end;
  $$;

create trigger tenant_info_empresa_implicita
  after insert or update of modo, rut_de_la_empresa, razon_social on tenant_info
  for each row execute function crear_empresa_implicita();

comment on function crear_empresa_implicita() is
  'La empresa implícita del modo `mi_flota` (§4.5, §3). Idempotente: conmutar '
  'mi_flota → daas → mi_flota no crea una segunda ni pierde una fila (centinela 11).';

insert into evento_tipo (codigo, descripcion) values
  ('gobierno.modo_conmutado', 'El dueño conmutó el modo del tenant entre mi_flota y daas');
