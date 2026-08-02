-- P0-1 (auditoría 1-ago-2026, verificado a mano contra el código): POST
-- /api/dispositivos/enrolar creaba el dispositivo NUEVO antes de verificar el PIN de
-- administrador, y pan.registrar_intento_pin() bloquea por el PAR (dispositivo_id,
-- usuario_id) — con un dispositivo virgen en cada intento, el contador de fallos
-- SIEMPRE valía 1 y la rama 423 nunca se alcanzaba. Fuerza bruta de 10.000
-- combinaciones de PIN, sin credenciales, desde internet; al acertar se obtiene un
-- equipo enrolado válido y de ahí una sesión de administrador completa.
--
-- El candado por dispositivo de pan.bloqueos_pin sigue intacto y sigue protegiendo
-- /api/auth/login (ahí el dispositivo YA existe antes de tocar el PIN, así que el
-- candado original sí acumula). Este es un candado HERMANO, dedicado al único camino
-- de PIN que no tiene todavía un dispositivo real: cuenta SOLO por usuario_id.

create table pan.intentos_pin_enrolamiento (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references pan.usuarios (id),
  exitoso boolean not null,
  at timestamptz not null default now()
);

create table pan.bloqueos_pin_enrolamiento (
  usuario_id uuid primary key references pan.usuarios (id),
  bloqueado_hasta timestamptz not null,
  motivo text not null default '5 intentos fallidos en 10 min (enrolamiento)'
);

create or replace function pan.registrar_intento_pin_enrolamiento(
  p_usuario_id uuid, p_exitoso boolean
) returns boolean -- true = permitido seguir; false = bloqueado
language plpgsql security definer as $$
declare
  fallos_recientes integer;
  ya_bloqueado timestamptz;
begin
  select bloqueado_hasta into ya_bloqueado
    from pan.bloqueos_pin_enrolamiento
   where usuario_id = p_usuario_id and bloqueado_hasta > now();
  if ya_bloqueado is not null then
    return false;
  end if;

  insert into pan.intentos_pin_enrolamiento (usuario_id, exitoso) values (p_usuario_id, p_exitoso);

  if p_exitoso then
    delete from pan.bloqueos_pin_enrolamiento where usuario_id = p_usuario_id;
    return true;
  end if;

  select count(*) into fallos_recientes
    from pan.intentos_pin_enrolamiento
   where usuario_id = p_usuario_id
     and exitoso = false
     and at > now() - interval '10 minutes';

  if fallos_recientes >= 5 then
    insert into pan.bloqueos_pin_enrolamiento (usuario_id, bloqueado_hasta)
    values (p_usuario_id, now() + interval '15 minutes')
    on conflict (usuario_id) do update set bloqueado_hasta = excluded.bloqueado_hasta;

    insert into pan.eventos (tipo, entidad, entidad_id, payload, usuario_id, dispositivo_id)
    values ('pin_bloqueado_enrolamiento', 'usuarios', p_usuario_id,
            jsonb_build_object('fallos', fallos_recientes), p_usuario_id, null);
    return false;
  end if;

  return true;
end;
$$;

grant insert, select on pan.intentos_pin_enrolamiento to pan_app;
grant insert, update, delete on pan.bloqueos_pin_enrolamiento to pan_app;
grant execute on function pan.registrar_intento_pin_enrolamiento(uuid, boolean) to pan_app;

-- Reversión:
-- drop function pan.registrar_intento_pin_enrolamiento(uuid, boolean);
-- drop table pan.bloqueos_pin_enrolamiento;
-- drop table pan.intentos_pin_enrolamiento;
