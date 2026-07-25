-- Hitos 4, 5 y 6 — Despacho, registro DTE y POD. Fuente: PROMPT_MAESTRO.md §4, §7.
-- Van juntos en una migración porque sus invariantes se cruzan: sin DTE no hay salida
-- a ruta, y el POD es lo que cierra el pedido que la guía amparó.
-- AC-DES-01..03, AC-DTE-01..02, AC-POD-01..03, AC-FIA-01.

-- ---------------------------------------------------------------------------
-- Clientes (canal reparto o mostrador; el fiado cuelga de acá)
-- ---------------------------------------------------------------------------
create table pan.clientes (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique check (pan.valida_rut(rut)),
  razon_social text not null,
  canal text not null check (canal in ('mostrador', 'reparto')),
  direccion text,
  lat numeric(9,6),
  lng numeric(9,6),
  contacto_nombre text,
  contacto_fono text,
  lista_precio text not null default 'mayorista' check (lista_precio in ('mostrador', 'mayorista')),
  activo boolean not null default true
);

alter table pan.ventas add constraint ventas_cliente_fk foreign key (cliente_id) references pan.clientes (id);

-- ---------------------------------------------------------------------------
-- Pedidos. correlativo_pedido lo asigna SOLO pan.asignar_correlativo() al confirmar,
-- y ningún UPDATE posterior puede tocarlo. Se llama correlativo, NO folio: el único
-- folio del sistema es el del SII (PROMPT_MAESTRO.md §4, §7).
-- ---------------------------------------------------------------------------
create sequence pan.correlativo_pedido_seq;

create table pan.pedidos (
  id uuid primary key default gen_random_uuid(),
  correlativo_pedido bigint unique,
  cliente_id uuid not null references pan.clientes (id),
  fecha_entrega date not null,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'confirmado', 'pesado', 'en_ruta', 'entregado', 'anulado')),
  total_clp integer not null default 0 check (total_clp >= 0),
  usuario_id uuid not null references pan.usuarios (id),
  dispositivo_id uuid not null references pan.dispositivos (id),
  creado_at timestamptz not null default now(),
  constraint pedidos_confirmado_tiene_correlativo
    check (estado = 'borrador' or estado = 'anulado' or correlativo_pedido is not null)
);

create table pan.pedido_lineas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pan.pedidos (id) on delete cascade,
  producto_id uuid not null references pan.productos (id),
  gramos_pedidos integer not null check (gramos_pedidos > 0),
  gramos_pesados integer not null default 0,  -- lo mantiene un trigger, JAMÁS la app
  gramos_entregados integer not null default 0,
  precio_clp integer not null check (precio_clp > 0), -- snapshot al confirmar
  unique (pedido_id, producto_id)
);

-- Ahora sí: pesajes.pedido_linea_id puede tener FK real (en 0002 era uuid suelto).
alter table pan.pesajes add constraint pesajes_pedido_linea_fk
  foreign key (pedido_linea_id) references pan.pedido_lineas (id);

create or replace function pan.asignar_correlativo(p_pedido_id uuid) returns bigint
language plpgsql security definer as $$
declare
  nuevo bigint;
begin
  if exists (select 1 from pan.pedidos where id = p_pedido_id and correlativo_pedido is not null) then
    raise exception 'el pedido % ya tiene correlativo asignado', p_pedido_id;
  end if;
  nuevo := nextval('pan.correlativo_pedido_seq');
  update pan.pedidos set correlativo_pedido = nuevo, estado = 'confirmado'
   where id = p_pedido_id and estado = 'borrador';
  if not found then
    raise exception 'el pedido % no está en borrador', p_pedido_id;
  end if;
  return nuevo;
end;
$$;

-- El correlativo es inmutable una vez puesto: ni la app ni un admin lo reescriben.
create or replace function pan.trg_correlativo_inmutable() returns trigger
language plpgsql as $$
begin
  if old.correlativo_pedido is not null and new.correlativo_pedido is distinct from old.correlativo_pedido then
    raise exception 'correlativo_pedido es inmutable (pedido %)', old.id;
  end if;
  return new;
end;
$$;
create trigger trg_pedidos_correlativo_inmutable
  before update on pan.pedidos
  for each row execute function pan.trg_correlativo_inmutable();

-- gramos_pesados lo mantiene la BD sumando pesajes reales, nunca la aplicación.
create or replace function pan.trg_sumar_pesaje_a_linea() returns trigger
language plpgsql security definer as $$
begin
  if new.pedido_linea_id is not null then
    update pan.pedido_lineas
       set gramos_pesados = gramos_pesados + new.gramos
     where id = new.pedido_linea_id;
  end if;
  return new;
end;
$$;
create trigger trg_pesajes_suman_linea
  after insert on pan.pesajes
  for each row execute function pan.trg_sumar_pesaje_a_linea();

-- ---------------------------------------------------------------------------
-- Documento tributario. La app JAMÁS emite: solo registra folios que el SII ya
-- emitió (art. 97 N°4 CT). No hay ciclo de emisión, no hay generación de folio.
-- consolidado_en_id (decisión #2 / AC-FIA-01): varias guías entregadas se agrupan
-- después en UNA factura; el índice único impide facturar dos veces la misma guía.
-- ---------------------------------------------------------------------------
create table pan.documento_tributario (
  id uuid primary key default gen_random_uuid(),
  tipo_dte integer not null check (tipo_dte in (33, 39, 52, 61)),
  folio_sii bigint not null,
  rut_emisor text not null check (pan.valida_rut(rut_emisor)),
  rut_receptor text check (rut_receptor is null or pan.valida_rut(rut_receptor)),
  fecha_emision date not null,
  monto_total integer not null check (monto_total >= 0),
  monto_neto integer,
  monto_iva integer,
  origen_captura text not null check (origen_captura in ('ted_scan', 'manual')),
  ted_xml text,
  ind_traslado integer, -- solo guías (52)
  estado text not null default 'registrado' check (estado in ('registrado', 'anulado')),
  pedido_id uuid references pan.pedidos (id),
  consolidado_en_id uuid references pan.documento_tributario (id),
  estado_pago text not null default 'pendiente' check (estado_pago in ('pendiente', 'pagada')),
  usuario_id uuid not null references pan.usuarios (id),
  dispositivo_id uuid not null references pan.dispositivos (id),
  registrado_at timestamptz not null default now(),
  unique (tipo_dte, folio_sii, rut_emisor),
  constraint dte_neto_iva_cuadran
    check (monto_neto is null or monto_iva is null or monto_neto + monto_iva = monto_total),
  constraint dte_ind_traslado_solo_guias check (ind_traslado is null or tipo_dte = 52),
  constraint dte_consolidado_no_es_si_mismo check (consolidado_en_id is distinct from id)
);

-- AC-FIA-01: ninguna guía se factura dos veces.
create unique index dte_una_consolidacion_por_guia
  on pan.documento_tributario (id) where consolidado_en_id is not null;

create index dte_pedido_idx on pan.documento_tributario (pedido_id);
create index dte_consolidado_idx on pan.documento_tributario (consolidado_en_id);

-- Saldo por cliente: VISTA derivada de eventos, jamás una tabla editable a mano
-- (mismo criterio que la TCK — ver decisión #2).
create or replace view pan.saldo_cliente as
select c.id as cliente_id,
       c.rut,
       c.razon_social,
       coalesce(sum(d.monto_total) filter (where d.estado_pago = 'pendiente' and d.estado = 'registrado'), 0)::integer
         as saldo_pendiente_clp
  from pan.clientes c
  left join pan.pedidos p on p.cliente_id = c.id
  left join pan.documento_tributario d on d.pedido_id = p.id
 group by c.id, c.rut, c.razon_social;

-- ---------------------------------------------------------------------------
-- Rutas y paradas. El odómetro manual manda para $/km; los GPS de los POD son apoyo.
-- ---------------------------------------------------------------------------
create table pan.rutas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  repartidor_id uuid not null references pan.usuarios (id),
  vehiculo text,
  estado text not null default 'planificada'
    check (estado in ('planificada', 'cargando', 'en_curso', 'cerrada')),
  km_inicio integer,
  km_fin integer,
  constraint rutas_km_fin_mayor check (km_fin is null or km_inicio is null or km_fin >= km_inicio)
);

create table pan.ruta_paradas (
  id uuid primary key default gen_random_uuid(),
  ruta_id uuid not null references pan.rutas (id),
  pedido_id uuid not null references pan.pedidos (id),
  orden integer not null,
  intento integer not null default 1,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'entregada', 'rechazada')),
  unique (ruta_id, orden)
);

-- AC-DES-02 / art. 55 DL 825: sin DTE asociado, la ruta NO sale. Sin override.
-- La multa va de 10% a 200% de 1 UTA con retención del vehículo, así que esto se
-- valida en la BD, no solo en la UI.
create or replace function pan.trg_ruta_exige_dte() returns trigger
language plpgsql as $$
declare
  sin_dte integer;
begin
  if new.estado = 'en_curso' and old.estado is distinct from 'en_curso' then
    select count(*) into sin_dte
      from pan.ruta_paradas rp
     where rp.ruta_id = new.id
       and not exists (
         select 1 from pan.documento_tributario d
          where d.pedido_id = rp.pedido_id and d.estado = 'registrado'
       );
    if sin_dte > 0 then
      raise exception 'no se puede salir a ruta: % pedido(s) sin DTE asociado (art. 55 DL 825)', sin_dte;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_rutas_exige_dte
  before update on pan.rutas
  for each row execute function pan.trg_ruta_exige_dte();

-- ---------------------------------------------------------------------------
-- Entregas (POD) — tabla canónica ÚNICA. Inmutable una vez cerrada; corregir es
-- insertar una fila nueva con supersede_id, jamás editar la original.
-- ---------------------------------------------------------------------------
create table pan.entregas (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  pedido_id uuid not null references pan.pedidos (id),
  supersede_id uuid references pan.entregas (id),
  receptor_nombre text not null,
  receptor_rut text check (receptor_rut is null or pan.valida_rut(receptor_rut)),
  firma_png text,
  foto_sha256 text not null,
  foto_estado text not null default 'pendiente_subida' check (foto_estado in ('pendiente_subida', 'subida')),
  -- Rango de Chile continental: un GPS en (0,0) rebota EN LA BD, no en la UI.
  lat numeric(9,6) not null check (lat between -56 and -17),
  lng numeric(9,6) not null check (lng between -76 and -66),
  precision_m integer not null,
  gps_degradado boolean not null default false,   -- >100 m: flag, NUNCA bloquea
  gps_fuera_de_zona boolean not null default false, -- >300 m del cliente: flag, no bloquea
  gramos_entregados integer not null check (gramos_entregados >= 0),
  motivo_rechazo text,
  cerrada boolean not null default false,
  usuario_id uuid not null references pan.usuarios (id),
  dispositivo_id uuid not null references pan.dispositivos (id),
  capturado_at timestamptz not null,          -- reloj del teléfono
  recibido_at timestamptz not null default now() -- reloj del servidor: manda para negocio
);

-- Un solo POD vigente por pedido; los reintentos y las correcciones (supersede) sí
-- pueden convivir — por eso el índice es parcial, no un UNIQUE a secas.
create unique index entregas_una_vigente_por_pedido
  on pan.entregas (pedido_id) where cerrada and supersede_id is null;

create index entregas_pedido_idx on pan.entregas (pedido_id);
create index entregas_recibido_at_idx on pan.entregas (recibido_at);

-- POD inmutable: una entrega cerrada no se edita ni se borra. Corrección = fila nueva.
create or replace function pan.trg_pod_inmutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'una entrega jamás se borra (POD es evidencia)';
  end if;
  if old.cerrada then
    -- Única excepción: marcar la foto como subida cuando termina el upload diferido.
    if new.foto_estado = 'subida' and old.foto_estado = 'pendiente_subida'
       and new.foto_sha256 = old.foto_sha256
       and to_jsonb(new) - 'foto_estado' = to_jsonb(old) - 'foto_estado' then
      return new;
    end if;
    raise exception 'entrega % ya está cerrada: corregir es insertar otra fila con supersede_id', old.id;
  end if;
  return new;
end;
$$;
create trigger trg_entregas_inmutable
  before update or delete on pan.entregas
  for each row execute function pan.trg_pod_inmutable();

create trigger trg_entregas_exige_sesion
  before insert on pan.entregas
  for each row execute function pan.trg_exige_sesion();

create trigger trg_pedidos_exige_sesion
  before insert on pan.pedidos
  for each row execute function pan.trg_exige_sesion();

create trigger trg_dte_exige_sesion
  before insert on pan.documento_tributario
  for each row execute function pan.trg_exige_sesion();

-- ---------------------------------------------------------------------------
-- Grants pan_app (bloque único al final — ver 0001 sobre por qué).
-- ---------------------------------------------------------------------------
grant select on all tables in schema pan to pan_app;
grant insert, update on pan.clientes to pan_app;
grant insert, update on pan.pedidos to pan_app;
grant insert, update on pan.pedido_lineas to pan_app;
grant insert on pan.documento_tributario to pan_app;
-- Solo estas dos columnas del DTE son editables: consolidar en factura y marcar pagada.
-- Un folio o un RUT registrado NUNCA se reescribe.
grant update (consolidado_en_id, estado_pago) on pan.documento_tributario to pan_app;
grant insert, update on pan.rutas to pan_app;
grant insert, update on pan.ruta_paradas to pan_app;
grant insert on pan.entregas to pan_app;
grant update (foto_estado) on pan.entregas to pan_app; -- confirmar subida diferida, nada más
grant usage on sequence pan.correlativo_pedido_seq to pan_app;
grant execute on function pan.asignar_correlativo(uuid) to pan_app;
