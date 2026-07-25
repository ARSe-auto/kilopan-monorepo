-- AC-SUC-01 (multisucursal ligero), AC-SEC-07 (fotos write-once), AC-PERF-01 (índices).

-- ---------------------------------------------------------------------------
-- AC-SUC-01 (decisión #7): multisucursal LIGERO — varios puntos de venta de un mismo
-- dueño alimentando un solo panel. NO es multi-tenant con permisos separados.
-- Regla de diseño: con una sola sucursal, el 95% de las panaderías no paga ni un
-- gramo de complejidad (el selector ni se muestra, y sucursal_id queda NULL).
-- ---------------------------------------------------------------------------
create table pan.sucursales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  direccion text,
  activa boolean not null default true
);

alter table pan.hornadas add column sucursal_id uuid references pan.sucursales (id);
alter table pan.pesajes add column sucursal_id uuid references pan.sucursales (id);
alter table pan.ventas add column sucursal_id uuid references pan.sucursales (id);
alter table pan.cierres_caja add column sucursal_id uuid references pan.sucursales (id);
alter table pan.rutas add column sucursal_id uuid references pan.sucursales (id);

-- La sucursal de un movimiento la hereda el DISPOSITIVO donde se hizo: el equipo vive
-- físicamente en un local. Así nadie tiene que elegirla a mano en cada pesaje.
create or replace function pan.trg_heredar_sucursal() returns trigger
language plpgsql as $$
begin
  if new.sucursal_id is null then
    select d.sucursal_id into new.sucursal_id
      from pan.dispositivos d where d.id = new.dispositivo_id;
  end if;
  return new;
end;
$$;

create trigger trg_pesajes_sucursal before insert on pan.pesajes
  for each row execute function pan.trg_heredar_sucursal();
create trigger trg_hornadas_sucursal before insert on pan.hornadas
  for each row execute function pan.trg_heredar_sucursal();
create trigger trg_ventas_sucursal before insert on pan.ventas
  for each row execute function pan.trg_heredar_sucursal();

-- ---------------------------------------------------------------------------
-- AC-SEC-07: las fotos son evidencia. Se guardan como filas write-once y el rol de
-- la app NO tiene DELETE — ni sobre la metadata ni (por contrato de despliegue) sobre
-- el bucket. Guardar el binario en la BD es una decisión consciente para el MVP de
-- una panadería: el volumen es chico (≈400 KB × pocos cientos al día) y evita montar
-- un object store para el piloto. Si el volumen crece, esta tabla pasa a guardar solo
-- la URL y el sha256 — el contrato de inmutabilidad no cambia.
-- ---------------------------------------------------------------------------
create table pan.fotos (
  sha256 text primary key,
  contenido bytea not null,
  mime text not null default 'image/jpeg',
  bytes integer not null check (bytes > 0),
  subida_por uuid not null references pan.usuarios (id),
  subida_at timestamptz not null default now()
);

-- Write-once de verdad: ni UPDATE ni DELETE, para nadie que no sea el dueño del
-- esquema. Una foto de POD jamás se re-apunta ni se borra (PROMPT_MAESTRO.md §7).
create or replace function pan.trg_foto_write_once() returns trigger
language plpgsql as $$
begin
  raise exception 'las fotos son evidencia: no se modifican ni se borran';
end;
$$;
create trigger trg_fotos_write_once
  before update or delete on pan.fotos
  for each row execute function pan.trg_foto_write_once();

-- ---------------------------------------------------------------------------
-- AC-PERF-01: índices en los filtros calientes. Los del día son los que corren en
-- cada carga del dashboard y de cada pantalla operativa.
-- ---------------------------------------------------------------------------
create index if not exists pesajes_capturado_at_idx on pan.pesajes (capturado_at);
create index if not exists pesajes_destino_fecha_idx on pan.pesajes (destino, capturado_at);
-- Sobre el timestamp directo, NO sobre (creado_at::date): castear timestamptz a date
-- depende de la zona horaria de la sesión, así que no es IMMUTABLE y Postgres no lo
-- acepta en un índice. Un btree sobre el timestamp sirve igual para los rangos del día.
create index if not exists ventas_creado_at_idx2 on pan.ventas (creado_at);
create index if not exists pedidos_fecha_estado_idx on pan.pedidos (fecha_entrega, estado);
create index if not exists ruta_paradas_ruta_orden_idx on pan.ruta_paradas (ruta_id, orden);
create index if not exists entregas_capturado_at_idx on pan.entregas (capturado_at);

grant select on all tables in schema pan to pan_app;
grant insert, update on pan.sucursales to pan_app;
grant insert on pan.fotos to pan_app; -- NUNCA update/delete: es evidencia
grant update (sucursal_id) on pan.dispositivos to pan_app;
