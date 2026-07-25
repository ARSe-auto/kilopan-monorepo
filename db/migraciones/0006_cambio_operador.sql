-- Corrección: F5 «cambio de operador» en un dispositivo COMPARTIDO (AC-ID-06).
--
-- Bug encontrado probando el login real, no leyendo código: el EXCLUDE de
-- sesiones_operador impide (bien) dos sesiones abiertas en el mismo equipo, y el
-- trigger de 0001 solo desplaza sesiones del mismo USUARIO en OTROS equipos. Nadie
-- cerraba la sesión previa DEL EQUIPO — así que cuando el vendedor tomaba la tablet
-- que dejó abierta el maestro, el login devolvía 500.
--
-- El prompt maestro pide justamente lo contrario: "dispositivos compartidos con
-- cambio de operador por PIN". Esta función hace el relevo atómico y auditado.

create or replace function pan.abrir_sesion(p_dispositivo_id uuid, p_usuario_id uuid)
returns uuid language plpgsql security definer as $$
declare
  sesion_previa record;
  nueva_id uuid;
begin
  -- Cierra la sesión que estuviera abierta EN ESTE EQUIPO (sea de quien sea) y deja
  -- la huella de quién relevó a quién: control sin perseguir a nadie.
  select id, usuario_id into sesion_previa
    from pan.sesiones_operador
   where dispositivo_id = p_dispositivo_id and fin is null
   limit 1;

  if found then
    update pan.sesiones_operador set fin = now() where id = sesion_previa.id;

    insert into pan.eventos (tipo, entidad, entidad_id, payload, usuario_id, dispositivo_id)
    values ('operador_relevado', 'sesiones_operador', sesion_previa.id,
            jsonb_build_object('usuario_saliente', sesion_previa.usuario_id,
                               'usuario_entrante', p_usuario_id),
            p_usuario_id, p_dispositivo_id);
  end if;

  insert into pan.sesiones_operador (dispositivo_id, usuario_id)
  values (p_dispositivo_id, p_usuario_id)
  returning id into nueva_id;

  return nueva_id;
end;
$$;

grant execute on function pan.abrir_sesion(uuid, uuid) to pan_app;

-- AC-ID-05: auto-bloqueo por inactividad. La UI cierra a los 10 min, pero el servidor
-- no puede confiar en que la UI lo haga (un cliente adulterado simplemente no lo
-- llamaría). Esta función es la que valida de verdad, y la usa obtenerSesionActual().
-- La columna va ANTES de la función: `LANGUAGE sql` valida su cuerpo al crearla (a
-- diferencia de plpgsql, que es perezoso), así que el orden acá no es cosmético.
alter table pan.sesiones_operador add column ultima_actividad timestamptz not null default now();

create or replace function pan.sesion_expirada(p_sesion_id uuid, p_minutos integer default 10)
returns boolean language sql stable as $$
  select coalesce(
    (select s.ultima_actividad < now() - make_interval(mins => p_minutos)
       from pan.sesiones_operador s where s.id = p_sesion_id and s.fin is null),
    true  -- si no existe o ya está cerrada, se considera expirada
  );
$$;

create or replace function pan.tocar_sesion(p_sesion_id uuid) returns void
language sql security definer as $$
  update pan.sesiones_operador set ultima_actividad = now()
   where id = p_sesion_id and fin is null;
$$;

grant execute on function pan.sesion_expirada(uuid, integer) to pan_app;
grant execute on function pan.tocar_sesion(uuid) to pan_app;
grant update (ultima_actividad) on pan.sesiones_operador to pan_app;
