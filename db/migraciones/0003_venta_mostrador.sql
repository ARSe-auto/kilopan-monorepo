-- Hito 3 — Venta mostrador. Fuente: PROMPT_MAESTRO.md §4 + decisión #5 (medios de
-- pago editables, no una lista fija en CHECK).
-- AC-VEN-01, AC-VEN-02, AC-PAG-01, AC-PAG-02.

-- ---------------------------------------------------------------------------
-- Corrección a 0002: un pesaje SIEMPRE es de un producto, incluso en "fase 1" sin
-- hornada (hornada_id NULL). Sin esto, pan.stock_disponible() no tiene forma de
-- saber qué se pesó cuando no hay hornada — todo pesaje de F1 (que hoy nunca crea
-- hornada) quedaría invisible para el stock. Encontrado escribiendo este hito, no en
-- el diseño original: se corrige con un ALTER, no reescribiendo 0002 ya aplicada.
-- ---------------------------------------------------------------------------
alter table pan.pesajes add column producto_id uuid references pan.productos (id);
update pan.pesajes p set producto_id = h.producto_id
  from pan.hornadas h where p.hornada_id = h.id and p.producto_id is null;
alter table pan.pesajes alter column producto_id set not null;
create index pesajes_producto_id_idx on pan.pesajes (producto_id);

create table pan.medios_pago (
  clave text primary key,
  etiqueta text not null,
  activo boolean not null default true,
  orden integer not null default 0
);

insert into pan.medios_pago (clave, etiqueta, orden) values
  ('efectivo', 'Efectivo', 1),
  ('debito', 'Débito', 2),
  ('credito', 'Crédito', 3),
  ('transferencia', 'Transferencia', 4),
  ('mercadopago', 'Mercado Pago', 5),
  ('mach', 'Mach', 6),
  ('fiado', 'Fiado (cliente registrado)', 7),
  ('otro', 'Otro', 8);

create table pan.ventas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid, -- FK real cuando exista pan.clientes (hito de despacho); fiado lo usa
  vendedor_id uuid not null references pan.usuarios (id),
  dispositivo_id uuid not null references pan.dispositivos (id),
  medio_pago text not null references pan.medios_pago (clave),
  total_clp integer not null check (total_clp >= 0),
  creado_at timestamptz not null default now(),
  constraint ventas_fiado_requiere_cliente check (medio_pago <> 'fiado' or cliente_id is not null)
);

create table pan.venta_lineas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references pan.ventas (id),
  producto_id uuid not null references pan.productos (id),
  gramos integer check (gramos between 1 and 100000),
  unidades integer check (unidades > 0),
  precio_clp integer not null check (precio_clp > 0), -- snapshot al vender, nunca recalculado
  constraint venta_lineas_gramos_xor_unidades check ((gramos is not null) <> (unidades is not null))
);

create table pan.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references pan.dispositivos (id),
  vendedor_id uuid not null references pan.usuarios (id),
  fecha date not null default current_date,
  medio_pago text not null references pan.medios_pago (clave),
  esperado_clp integer not null,
  declarado_clp integer not null,
  total_facturador_clp integer, -- AC-DASH-04 (decisión #3, fase 1): tecleado, comparado contra declarado
  cerrado_at timestamptz not null default now()
);

create index ventas_creado_at_idx on pan.ventas (creado_at);
create index venta_lineas_venta_id_idx on pan.venta_lineas (venta_id);

-- Corrección a pan.trg_exige_sesion() (0001): asumía columnas literales usuario_id/
-- dispositivo_id. pan.ventas usa vendedor_id (más claro en su dominio) — en vez de
-- forzar el nombre de columna o duplicar la función por tabla, se hace la función
-- genérica de verdad vía argumentos del trigger (TG_ARGV), leyendo el valor por
-- nombre con to_jsonb(NEW). Sin argumentos, cae a usuario_id/dispositivo_id — los
-- triggers ya creados en 0002 (pesajes, hornadas) siguen funcionando sin tocarlos.
create or replace function pan.trg_exige_sesion() returns trigger
language plpgsql as $$
declare
  col_usuario text := coalesce(nullif(tg_argv[0], ''), 'usuario_id');
  col_dispositivo text := coalesce(nullif(tg_argv[1], ''), 'dispositivo_id');
  fila jsonb := to_jsonb(new);
begin
  perform pan.exige_sesion_viva(
    (fila ->> col_usuario)::uuid,
    (fila ->> col_dispositivo)::uuid
  );
  return new;
end;
$$;

create trigger trg_ventas_exige_sesion
  before insert on pan.ventas
  for each row execute function pan.trg_exige_sesion('vendedor_id');

-- AC-VEN-02: "venta contra el stock ya pesado" — disponible = pesado a mostrador
-- menos ya vendido, SIEMPRE derivado de eventos (pesajes/venta_lineas), nunca un
-- contador guardado que se pueda desincronizar.
create or replace function pan.stock_disponible(p_producto_id uuid) returns integer
language sql stable as $$
  select coalesce(
    (select sum(p.gramos) from pan.pesajes p
      where p.producto_id = p_producto_id and p.destino = 'mostrador'), 0
  ) - coalesce(
    (select sum(vl.gramos) from pan.venta_lineas vl
      where vl.producto_id = p_producto_id and vl.gramos is not null), 0
  );
$$;

-- Mismo bug que stock_disponible, mismo arreglo: usar pesajes.producto_id directo en
-- vez de pasar por hornadas (que en fase 1 es NULL).
create or replace function pan.es_outlier_pesaje(p_producto_id uuid, p_gramos integer)
returns boolean language plpgsql stable as $$
declare
  n integer;
  mediana numeric;
begin
  select count(*), percentile_cont(0.5) within group (order by gramos)
    into n, mediana
    from pan.pesajes
   where producto_id = p_producto_id;

  if n < 3 or mediana is null or mediana = 0 then
    return false;
  end if;
  return p_gramos > mediana * 3;
end;
$$;

grant select on all tables in schema pan to pan_app;
grant insert on pan.ventas to pan_app;
grant insert on pan.venta_lineas to pan_app;
grant insert on pan.cierres_caja to pan_app;
grant update (activo) on pan.medios_pago to pan_app; -- admin prende/apaga, nunca borra
grant execute on function pan.stock_disponible(uuid) to pan_app;
