-- Hito 1 — Identidad y dispositivos. Fuente: PROMPT_MAESTRO.md §4, §7.
-- AC-ID-01..06, AC-SEC-01, AC-SEC-02.
create schema if not exists pan;
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist; -- EXCLUDE USING gist sobre tstzrange

-- ---------------------------------------------------------------------------
-- Utilidades puras (comun) — canónicas en BD; TS en apps/kilopan/src/comun es
-- la copia de referencia para el cliente, pero la BD es la que manda.
-- ---------------------------------------------------------------------------

create or replace function pan.round_clp(valor numeric) returns integer
language sql immutable as $$
  select round(valor)::integer;
$$;

create or replace function pan.valida_rut(rut text) returns boolean
language plpgsql immutable as $$
declare
  limpio text := upper(regexp_replace(rut, '[\.\s]', '', 'g'));
  cuerpo text;
  dv text;
  suma integer := 0;
  multiplo integer := 2;
  i integer;
  resto integer;
  dv_esperado text;
begin
  if limpio !~ '^[0-9]+-?[0-9K]$' then
    return false;
  end if;
  dv := right(limpio, 1);
  cuerpo := regexp_replace(left(limpio, length(limpio) - 1), '-', '', 'g');
  if length(cuerpo) < 7 or length(cuerpo) > 8 then
    return false;
  end if;
  for i in 0 .. length(cuerpo) - 1 loop
    suma := suma + (substr(cuerpo, length(cuerpo) - i, 1)::integer) * multiplo;
    multiplo := case when multiplo = 7 then 2 else multiplo + 1 end;
  end loop;
  resto := 11 - (suma % 11);
  dv_esperado := case when resto = 11 then '0' when resto = 10 then 'K' else resto::text end;
  return dv_esperado = dv;
end;
$$;

-- append-only, alimenta dashboard/TCK/auditoría (§4)
create table pan.eventos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  entidad text not null,
  entidad_id uuid,
  payload jsonb not null default '{}'::jsonb,
  usuario_id uuid,
  dispositivo_id uuid,
  at timestamptz not null default now()
);
revoke update, delete on pan.eventos from public;

-- ---------------------------------------------------------------------------
-- AC-SEC-08: rol de aplicación de mínimo privilegio. La API jamás se conecta como
-- superusuario/dueño del esquema — eso es justamente lo que un REVOKE FROM PUBLIC
-- no alcanza a frenar (dueño y superusuario lo ignoran). Todo test de invariante
-- que dependa de un REVOKE debe correr "SET ROLE pan_app" primero, o no prueba nada
-- (lección aprendida al escribir el propio test de este hito).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pan_app') then
    create role pan_app login;
  end if;
end
$$;
-- Los GRANT van al final del archivo (bloque único), después de que TODAS las
-- tablas existen: "GRANT ... ON ALL TABLES IN SCHEMA" solo alcanza a las tablas
-- que YA existen al momento de correr el GRANT — no es retroactivo. Hacerlo antes
-- de tiempo produce un pan_app con privilegios incompletos que falla en runtime,
-- no en el gate (encontrado al escribir el test de este mismo hito).

-- ---------------------------------------------------------------------------
-- usuarios / dispositivos / sesiones
-- ---------------------------------------------------------------------------

create table pan.usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rut text not null unique,
  rol text not null check (rol in ('admin', 'maestro', 'vendedor', 'repartidor')),
  pin_hash text not null,
  clave_hash text, -- solo admin/web
  activo boolean not null default true,
  creado_at timestamptz not null default now(),
  constraint usuarios_rut_valido check (pan.valida_rut(rut))
);

create table pan.dispositivos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  secreto_hash text not null,
  sucursal_id uuid, -- AC-SUC-01: se rellena en el hito de multisucursal; NULL = única sucursal
  enrolado_por uuid not null references pan.usuarios (id),
  enrolado_at timestamptz not null default now(),
  revocado_at timestamptz -- jamás DELETE
);

create table pan.sesiones_operador (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references pan.dispositivos (id),
  usuario_id uuid not null references pan.usuarios (id),
  inicio timestamptz not null default now(),
  fin timestamptz,
  exclude using gist (
    dispositivo_id with =,
    tstzrange(inicio, coalesce(fin, 'infinity'::timestamptz)) with &&
  )
);

-- AC-ID-04: sesión nueva del mismo usuario en OTRO dispositivo desplaza la anterior.
create or replace function pan.desplazar_sesiones_usuario() returns trigger
language plpgsql security definer as $$
begin
  update pan.sesiones_operador
     set fin = now()
   where usuario_id = new.usuario_id
     and dispositivo_id <> new.dispositivo_id
     and fin is null;

  insert into pan.eventos (tipo, entidad, entidad_id, payload, usuario_id, dispositivo_id)
  select 'sesion_desplazada', 'sesiones_operador', s.id,
         jsonb_build_object('dispositivo_anterior', s.dispositivo_id, 'dispositivo_nuevo', new.dispositivo_id),
         new.usuario_id, new.dispositivo_id
    from pan.sesiones_operador s
   where s.usuario_id = new.usuario_id
     and s.dispositivo_id <> new.dispositivo_id
     and s.fin = now();
  return new;
end;
$$;

create trigger trg_desplazar_sesiones
  after insert on pan.sesiones_operador
  for each row execute function pan.desplazar_sesiones_usuario();

-- ---------------------------------------------------------------------------
-- AC-SEC-01: bloqueo por PIN errado — 5 intentos en 10 min => bloqueo 15 min.
-- No estaba en el prompt maestro original; un PIN de 4 dígitos son 10.000
-- combinaciones, así que esto es P0, no un "nice to have".
-- ---------------------------------------------------------------------------

create table pan.intentos_pin (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references pan.dispositivos (id),
  usuario_id uuid references pan.usuarios (id), -- NULL si el RUT/usuario ni siquiera existe
  exitoso boolean not null,
  at timestamptz not null default now()
);

create table pan.bloqueos_pin (
  dispositivo_id uuid not null references pan.dispositivos (id),
  usuario_id uuid not null references pan.usuarios (id),
  bloqueado_hasta timestamptz not null,
  motivo text not null default '5 intentos fallidos en 10 min',
  primary key (dispositivo_id, usuario_id)
);

create or replace function pan.registrar_intento_pin(
  p_dispositivo_id uuid, p_usuario_id uuid, p_exitoso boolean
) returns boolean -- true = permitido seguir; false = bloqueado
language plpgsql security definer as $$
declare
  fallos_recientes integer;
  ya_bloqueado timestamptz;
begin
  select bloqueado_hasta into ya_bloqueado
    from pan.bloqueos_pin
   where dispositivo_id = p_dispositivo_id and usuario_id = p_usuario_id
     and bloqueado_hasta > now();
  if ya_bloqueado is not null then
    return false;
  end if;

  insert into pan.intentos_pin (dispositivo_id, usuario_id, exitoso)
  values (p_dispositivo_id, p_usuario_id, p_exitoso);

  if p_exitoso then
    delete from pan.bloqueos_pin where dispositivo_id = p_dispositivo_id and usuario_id = p_usuario_id;
    return true;
  end if;

  select count(*) into fallos_recientes
    from pan.intentos_pin
   where dispositivo_id = p_dispositivo_id
     and usuario_id = p_usuario_id
     and exitoso = false
     and at > now() - interval '10 minutes';

  if fallos_recientes >= 5 then
    insert into pan.bloqueos_pin (dispositivo_id, usuario_id, bloqueado_hasta)
    values (p_dispositivo_id, p_usuario_id, now() + interval '15 minutes')
    on conflict (dispositivo_id, usuario_id)
    do update set bloqueado_hasta = excluded.bloqueado_hasta;

    insert into pan.eventos (tipo, entidad, entidad_id, payload, usuario_id, dispositivo_id)
    values ('pin_bloqueado', 'usuarios', p_usuario_id,
            jsonb_build_object('fallos', fallos_recientes), p_usuario_id, p_dispositivo_id);
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- AC-ID-02: sin sesión de operador viva, ningún write de negocio pasa.
-- Se aplica en las tablas de negocio a medida que se crean (hitos 2+); aquí queda
-- la función que todas reusan.
-- ---------------------------------------------------------------------------

create or replace function pan.exige_sesion_viva(p_usuario_id uuid, p_dispositivo_id uuid)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pan.sesiones_operador
     where usuario_id = p_usuario_id
       and dispositivo_id = p_dispositivo_id
       and fin is null
  ) then
    raise exception 'sin sesión de operador viva para usuario % en dispositivo %', p_usuario_id, p_dispositivo_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants de pan_app (mínimo privilegio; eventos NUNCA recibe update/delete).
-- Bloque único, al final, con todas las tablas ya creadas (ver nota más arriba).
-- ---------------------------------------------------------------------------
grant usage on schema pan to pan_app;
grant select on all tables in schema pan to pan_app;
grant insert, update on pan.usuarios to pan_app;
grant insert, update on pan.dispositivos to pan_app;
grant insert, update on pan.sesiones_operador to pan_app;
grant insert on pan.intentos_pin to pan_app;
grant insert, update, delete on pan.bloqueos_pin to pan_app; -- delete = expiración limpiada por job, no por la app en caliente
grant insert on pan.eventos to pan_app; -- select ya viene del GRANT ALL TABLES de arriba; NUNCA update/delete
grant execute on function pan.round_clp(numeric) to pan_app;
grant execute on function pan.valida_rut(text) to pan_app;
grant execute on function pan.registrar_intento_pin(uuid, uuid, boolean) to pan_app;
grant execute on function pan.exige_sesion_viva(uuid, uuid) to pan_app;
