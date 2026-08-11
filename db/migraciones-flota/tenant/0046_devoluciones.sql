-- 0046 — `devoluciones`: el término `devuelto` de la ecuación, con su detalle. [AC-FRUT-21]
--
-- La 0045 ya declaró QUIÉN lo consume: `cierre_ruta_empresa.devuelto` es el NÚMERO que la
-- ecuación de cierre necesita, y esta migración es su fuente — «AC-FRUT-21 materializa filas de
-- `devoluciones` desde el término `devuelto` que se declara acá. El orden es ese y no al revés».
--
-- La ecuación NO cambia con esta migración: `ecuacion_de_cierre()` sigue sumando
-- `cierre_ruta_empresa.devuelto` (§4.5), que la clasificación táctil del §5.2 F5 escribe SOLA,
-- de un toque. `devoluciones` es el detalle que ese toque deja por escrito para el devengo del
-- módulo 06 (§3.E1.9) — empresa, bultos y motivo — y no una segunda fuente de la que la ecuación
-- tuviera que leer: dos fuentes del mismo número son el día en que dejan de coincidir.
--
-- ─── POR QUÉ LA FK VA A `cierre_ruta_empresa`, Y NO A `cierres_ruta` + `empresas_cliente` SUELTAS
--
-- `cierre_ruta_empresa` ya tiene `unique (tenant_id, cierre_id, empresa_cliente_id)` (0045): es
-- el renglón declarado que esta tabla detalla. Una FK compuesta contra ESA clave, en vez de dos
-- FKs sueltas, hace imposible por construcción que exista una devolución de una empresa que ese
-- cierre nunca declaró — el mismo tipo de garantía que el §0 pide con las FK compuestas
-- `(tenant_id, id)` en todo el módulo.
--
-- ─── CAPTURA, NO PLANIFICACIÓN ─────────────────────────────────────────────────────
--
-- El §4.2 la nombra literalmente en la lista CAPTURA (spec 03 §1): el descuadre ya ocurrió en el
-- andén y la clasificación es la constancia de dónde quedó. Por eso `client_uuid` +
-- `unique(tenant_id, client_uuid)` + `on conflict do nothing` —el replay del outbox no duplica— y
-- por eso jamás rebota: viaja colgada del mismo POST de cierre, que ya es 2xx siempre (AC-FRUT-11).

create table devoluciones (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  cierre_id          uuid        not null,
  empresa_cliente_id uuid        not null,
  -- Bultos, la misma unidad que `cierre_ruta_empresa.devuelto`: la clasificación táctil asigna
  -- TODA la diferencia de una vez (§5.2 F5, `dominio/cierre.ts::clasificar`), así que esta fila
  -- es el detalle de ESE número — no una entre varias que tuvieran que sumar hasta él.
  bultos             int         not null check (bultos > 0),
  motivo_id          uuid        not null,
  ts_dispositivo     timestamptz not null,
  tz_offset_min      int         not null,
  record_time        timestamptz not null default now(),
  client_uuid        uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Centinela 1: el replay del outbox deja exactamente 1 fila por `client_uuid` (§9.3.1).
  unique (tenant_id, client_uuid),
  -- Una sola devolución por empresa dentro de un cierre: la clasificación táctil no parte la
  -- diferencia (§5.2 F5), así que dos filas para la misma empresa del mismo cierre serían dos
  -- constancias de un mismo toque.
  unique (tenant_id, cierre_id, empresa_cliente_id),
  foreign key (tenant_id, cierre_id, empresa_cliente_id)
    references cierre_ruta_empresa (tenant_id, cierre_id, empresa_cliente_id),
  foreign key (tenant_id, motivo_id) references motivos (tenant_id, id)
);
create index devoluciones_tenant_cierre_idx on devoluciones (tenant_id, cierre_id);
create index devoluciones_tenant_empresa_idx on devoluciones (tenant_id, empresa_cliente_id);
create index devoluciones_tenant_motivo_idx on devoluciones (tenant_id, motivo_id);

comment on table devoluciones is
  'CAPTURA — el detalle de un `devuelto` de la ecuación de cierre (§4.5, §3.E1.6): empresa, '
  'bultos y motivo del catálogo del tenant. Jamás rebota al sincronizar; viaja con el mismo '
  'POST de cierre que la crea (AC-FRUT-11). Fuente de la línea `por_devolucion` que el módulo '
  '06 (hito f) devenga (§3.E1.9).';

comment on column devoluciones.motivo_id is
  'Del catálogo `motivos` del tenant (§4.5). NOT NULL: sin motivo no hay fila — la clasificación '
  'táctil lo exige en el CLIENTE antes de ofrecer «Cerrar la ruta» (§4.2), y el servidor, que '
  'nunca rebota una captura, simplemente no materializa la fila si llegó sin él.';

-- Append-only por las dos capas del §7.4, igual que `cierres_ruta` en la 0045: un motivo que se
-- pudiera corregir con UPDATE dejaría de ser la constancia de lo que el chofer clasificó esa noche.
revoke update, delete on devoluciones from public;

create trigger devoluciones_append_only
  before update or delete on devoluciones
  for each row execute function rechazar_mutacion_de_hecho();
create trigger devoluciones_append_only_truncate
  before truncate on devoluciones
  for each statement execute function rechazar_mutacion_de_hecho();

-- El confinamiento del §7.2: `devoluciones` tiene su propia `empresa_cliente_id`, así que el
-- rol `cliente` se confina igual que en `cierre_ruta_empresa` — su devolución, ninguna otra.
select aplicar_rls_de_empresa('devoluciones');

insert into evento_tipo (codigo, descripcion) values
  ('devolucion.registrada',
   'La clasificación táctil del cierre materializó una devolución con empresa, bultos y motivo (§5.2 F5)');
