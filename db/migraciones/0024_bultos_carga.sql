-- ---------------------------------------------------------------------------
-- 0024 — bultos con correlativo + gate de carga en «Salir a ruta»
-- (AC-DES-04 · PROMPT_MAESTRO.md §5 F2/F3 · sesión supervisada 06-ago-2026)
--
-- Dos iteraciones del motor declararon el bloqueo real: F3 (cargar van con escáner y
-- contador N/M) no se puede construir sin esquema de bultos, y el motor tiene VEDADO
-- escribir aquí (docs/PROMPT_CORRECTIVO.md §7). Esta migración la decide y aplica la
-- sesión supervisada, calcando los patrones ya probados del repo:
--   · nacimiento SOLO por función, identidad inmutable por trigger (0004, correlativo)
--   · gate de salida como trigger en pan.rutas, probado en ambos sentidos (0019, DTE)
--   · excepción auditada que el MISMO trigger deja en pan.eventos (0020-0022)
-- La UI de F3 (escáner, beep, contador, banner ámbar) la construye el motor SOBRE esto.
-- Compatibilidad: un pedido SIN bultos generados no gatilla el gate (pendientes = 0) —
-- las rutas e historial previos a esta migración salen igual que antes.
-- ---------------------------------------------------------------------------

-- El código escaneable es determinista: 'P<correlativo_pedido>-<n>'. Code128/QR si hay
-- impresora; número de bulto en 96 px si no — mismo dato, cero rama muerta (§5 F2).
create table pan.bultos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pan.pedidos (id),
  correlativo integer not null check (correlativo >= 1),
  codigo text not null unique,
  cargado_at timestamptz,
  cargado_usuario_id uuid references pan.usuarios (id),
  cargado_dispositivo_id uuid references pan.dispositivos (id),
  creado_at timestamptz not null default now(),
  unique (pedido_id, correlativo),
  check ((cargado_at is null) = (cargado_usuario_id is null))
);
create index bultos_pedido_idx on pan.bultos (pedido_id);

-- Nacen al cerrar el pedido, todos de una vez. Regenerar es operación supervisada.
create or replace function pan.generar_bultos(p_pedido_id uuid, p_cantidad integer)
returns integer
language plpgsql security definer as $$
declare
  v_correlativo bigint;
  v_estado text;
  i integer;
begin
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 500 then
    raise exception 'cantidad de bultos fuera de rango (1-500): %', p_cantidad;
  end if;
  select estado, correlativo_pedido into v_estado, v_correlativo
    from pan.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'pedido % no existe', p_pedido_id;
  end if;
  if v_estado not in ('confirmado', 'pesado') then
    raise exception 'los bultos nacen con el pedido cerrado (confirmado o pesado); está %', v_estado;
  end if;
  if exists (select 1 from pan.bultos where pedido_id = p_pedido_id) then
    raise exception 'el pedido % ya tiene bultos generados — regenerar es operación supervisada', p_pedido_id;
  end if;
  perform set_config('pan.generando_bultos', p_pedido_id::text, true);
  for i in 1..p_cantidad loop
    insert into pan.bultos (pedido_id, correlativo, codigo)
    values (p_pedido_id, i, 'P' || v_correlativo || '-' || i);
  end loop;
  perform set_config('pan.generando_bultos', '', true);
  return p_cantidad;
end;
$$;

-- Escanear = cargar. Un bulto ya escaneado rebota (la API lo traduce a 409 y la UI al
-- banner ámbar de «duplicada», §5 F3). Quién y con qué dispositivo queda en la fila.
create or replace function pan.cargar_bulto(p_codigo text, p_usuario_id uuid, p_dispositivo_id uuid)
returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
  v_cargado timestamptz;
begin
  select id, cargado_at into v_id, v_cargado
    from pan.bultos where codigo = p_codigo for update;
  if not found then
    raise exception 'bulto % no existe', p_codigo;
  end if;
  if v_cargado is not null then
    raise exception 'bulto % ya escaneado', p_codigo;
  end if;
  perform set_config('pan.cargando_bulto', v_id::text, true);
  update pan.bultos
     set cargado_at = now(),
         cargado_usuario_id = p_usuario_id,
         cargado_dispositivo_id = p_dispositivo_id
   where id = v_id;
  perform set_config('pan.cargando_bulto', '', true);
  return v_id;
end;
$$;

-- Un bulto nace por generar_bultos, se carga por cargar_bulto, y NADA más lo toca:
-- ni re-escaneo, ni «descarga», ni edición de identidad, ni DELETE. Mismo patrón que
-- trg_correlativo_inmutable y trg_entregas_inmutable (0004).
create or replace function pan.trg_bultos_solo_funciones() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('pan.generando_bultos', true), '') <> new.pedido_id::text then
      raise exception 'los bultos nacen SOLO por pan.generar_bultos() al cerrar el pedido';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(current_setting('pan.cargando_bulto', true), '') <> old.id::text then
      raise exception 'un bulto se carga SOLO por pan.cargar_bulto(); nada más se edita';
    end if;
    if new.pedido_id <> old.pedido_id or new.correlativo <> old.correlativo
       or new.codigo <> old.codigo or new.creado_at <> old.creado_at
       or old.cargado_at is not null then
      raise exception 'bulto inmutable: identidad y carga no se reescriben';
    end if;
    return new;
  end if;
  raise exception 'los bultos no se borran (append-only, como el POD)';
end;
$$;
create trigger trg_bultos_solo_funciones
  before insert or update or delete on pan.bultos
  for each row execute function pan.trg_bultos_solo_funciones();

-- «Salir a ruta» exige 100 % de bultos escaneados O confirmación auditada — la única
-- modal permitida (§5 F3). El override viaja en el MISMO update que mueve el estado y
-- el trigger lo deja escrito en pan.eventos: sin evento no hubo excepción.
alter table pan.rutas
  add column bultos_override_motivo text,
  add column bultos_override_usuario_id uuid references pan.usuarios (id),
  add constraint rutas_bultos_override_completo
    check ((bultos_override_motivo is null) = (bultos_override_usuario_id is null));

create or replace function pan.trg_ruta_exige_bultos_cargados() returns trigger
language plpgsql as $$
declare
  pendientes integer;
begin
  if new.estado = 'en_curso' and old.estado is distinct from 'en_curso' then
    select count(*) into pendientes
      from pan.bultos b
      join pan.ruta_paradas rp on rp.pedido_id = b.pedido_id
     where rp.ruta_id = new.id
       and b.cargado_at is null;
    if pendientes > 0 then
      if new.bultos_override_motivo is null then
        raise exception 'no se puede salir a ruta: % bulto(s) sin escanear — carga el 100%% o confirma con motivo', pendientes;
      end if;
      insert into pan.eventos (tipo, entidad, entidad_id, payload, usuario_id)
      values ('ruta.salida_con_bultos_pendientes', 'ruta', new.id,
              jsonb_build_object('pendientes', pendientes, 'motivo', new.bultos_override_motivo),
              new.bultos_override_usuario_id);
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_ruta_exige_bultos_cargados
  before update on pan.rutas
  for each row execute function pan.trg_ruta_exige_bultos_cargados();

-- pan_app LEE bultos y ejecuta las DOS funciones. Jamás recibe insert/update/delete
-- directos: las funciones son SECURITY DEFINER (corren como el dueño) y el trigger
-- rebota cualquier escritura ajena igual — defensa doble, como en 0021.
grant select on pan.bultos to pan_app;
grant execute on function pan.generar_bultos(uuid, integer) to pan_app;
grant execute on function pan.cargar_bulto(text, uuid, uuid) to pan_app;

-- Reversión: drop trigger trg_ruta_exige_bultos_cargados on pan.rutas;
--            drop function pan.trg_ruta_exige_bultos_cargados();
--            alter table pan.rutas drop constraint rutas_bultos_override_completo,
--              drop column bultos_override_motivo, drop column bultos_override_usuario_id;
--            drop trigger trg_bultos_solo_funciones on pan.bultos;
--            drop function pan.trg_bultos_solo_funciones();
--            drop function pan.cargar_bulto(text, uuid, uuid);
--            drop function pan.generar_bultos(uuid, integer);
--            drop table pan.bultos;
