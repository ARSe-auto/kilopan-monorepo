-- Hito 2 — Catálogo y pesaje. Fuente: PROMPT_MAESTRO.md §4 + docs/DECISIONES_AMPLIACION.md.
-- AC-PES-01..05, AC-ID-02 (cableada por primera vez sobre una tabla de negocio real).

create table pan.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo_venta text not null check (tipo_venta in ('kilo', 'unidad')),
  codigo_barras text unique,
  activo boolean not null default true
);

create table pan.precios (
  producto_id uuid not null references pan.productos (id),
  lista text not null check (lista in ('mostrador', 'mayorista')),
  precio_clp integer not null check (precio_clp > 0),
  vigente_desde date not null default current_date,
  primary key (producto_id, lista, vigente_desde)
);

create table pan.hornadas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references pan.productos (id),
  fecha date not null default current_date,
  masa_gramos integer not null check (masa_gramos > 0),
  usuario_id uuid not null references pan.usuarios (id),
  dispositivo_id uuid not null references pan.dispositivos (id),
  creado_at timestamptz not null default now()
);

-- pedido_linea_id: FK real se agrega con ALTER en el hito de despacho (0004), cuando
-- pedido_lineas exista. Hasta entonces es un uuid suelto — el CHECK de abajo igual
-- exige que venga acompañado cuando destino='reparto'.
create table pan.pesajes (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique, -- idempotencia (mismo patrón que POD)
  hornada_id uuid references pan.hornadas (id), -- NULL admitido: "fase 1" del prompt maestro
  pedido_linea_id uuid,
  gramos integer not null check (gramos between 1 and 100000),
  destino text not null check (destino in ('mostrador', 'reparto', 'merma')),
  motivo_merma text check (motivo_merma in ('quemado', 'sobrante_dia', 'devolucion_cliente', 'otro')),
  -- AC-MERM-01 (decisión #6): sobrante_dia nace 'pendiente' y se resuelve al día
  -- siguiente. La TCK no cambia de fórmula — el gramaje recuperado simplemente pasa a
  -- contarse como venta en vez de como merma en la vista de conciliación (hito 7).
  estado_merma text check (estado_merma in ('pendiente', 'confirmada_perdida', 'recuperada_con_venta')),
  venta_recuperada_id uuid, -- FK real cuando exista `ventas` (hito 3)
  -- AC-PES-04 (decisión #1, nivel 1): foto opcional, solo si admin prende
  -- parametros.pesaje_foto_obligatoria. Mismo contrato write-once que el POD.
  foto_sha256 text,
  foto_estado text check (foto_estado in ('pendiente_subida', 'subida')),
  -- AC-PES-05 (decisión #1, nivel 2): de dónde vino el número. 'manual' es el único
  -- camino garantizado en todo dispositivo (Web Bluetooth no existe en Safari/iOS).
  origen_captura text not null default 'manual' check (origen_captura in ('manual', 'bascula_bt', 'bascula_serial')),
  usuario_id uuid not null references pan.usuarios (id),
  dispositivo_id uuid not null references pan.dispositivos (id),
  capturado_at timestamptz not null, -- reloj del teléfono (diagnóstico, TCK)
  recibido_at timestamptz not null default now(), -- reloj del servidor (manda para negocio)
  constraint pesajes_reparto_requiere_pedido
    check ((destino = 'reparto') = (pedido_linea_id is not null)),
  constraint pesajes_merma_requiere_motivo
    check ((destino = 'merma') = (motivo_merma is not null)),
  constraint pesajes_merma_requiere_estado
    check ((destino = 'merma') = (estado_merma is not null)),
  constraint pesajes_venta_recuperada_solo_si_recuperada
    check (venta_recuperada_id is null or estado_merma = 'recuperada_con_venta'),
  constraint pesajes_foto_estado_requiere_sha
    check (foto_estado is null or foto_sha256 is not null)
);

create index pesajes_recibido_at_idx on pan.pesajes (recibido_at); -- AC-PERF-01: TCK filtra por día

-- ---------------------------------------------------------------------------
-- AC-ID-02: primera tabla de negocio real — acá se cablea de verdad
-- pan.exige_sesion_viva(), que hasta ahora solo existía como función suelta.
-- ---------------------------------------------------------------------------
create or replace function pan.trg_exige_sesion() returns trigger
language plpgsql as $$
begin
  perform pan.exige_sesion_viva(new.usuario_id, new.dispositivo_id);
  return new;
end;
$$;

create trigger trg_pesajes_exige_sesion
  before insert on pan.pesajes
  for each row execute function pan.trg_exige_sesion();

create trigger trg_hornadas_exige_sesion
  before insert on pan.hornadas
  for each row execute function pan.trg_exige_sesion();

-- ---------------------------------------------------------------------------
-- AC-PES-03: soporte del test centinela "báscula mal tipeada". Fase 1: mediana
-- SOLO por producto (todavía no hay cliente — pedido_linea_id llega en el hito de
-- despacho). Sin historia suficiente (<3 pesajes previos del producto), nunca marca
-- outlier: no hay base para comparar, y castigar el primer pesaje del día sería
-- exactamente el falso positivo que el propio prompt maestro pide evitar.
-- ---------------------------------------------------------------------------
create or replace function pan.es_outlier_pesaje(p_producto_id uuid, p_gramos integer)
returns boolean language plpgsql stable as $$
declare
  n integer;
  mediana numeric;
begin
  select count(*), percentile_cont(0.5) within group (order by p.gramos)
    into n, mediana
    from pan.pesajes p
    join pan.hornadas h on h.id = p.hornada_id
   where h.producto_id = p_producto_id;

  if n < 3 or mediana is null or mediana = 0 then
    return false;
  end if;
  return p_gramos > mediana * 3;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants pan_app (mínimo privilegio; ver 0001 para el porqué del bloque único).
-- ---------------------------------------------------------------------------
grant select on all tables in schema pan to pan_app;
grant insert, update on pan.productos to pan_app;
grant insert, update on pan.precios to pan_app;
grant insert on pan.hornadas to pan_app;
grant insert on pan.pesajes to pan_app;
-- Resolución de merma (AC-MERM-01): solo estas dos columnas son editables, y solo
-- tienen sentido cuando destino='merma' (el CHECK de la tabla ya lo exige).
grant update (estado_merma, venta_recuperada_id) on pan.pesajes to pan_app;
grant execute on function pan.es_outlier_pesaje(uuid, integer) to pan_app;
