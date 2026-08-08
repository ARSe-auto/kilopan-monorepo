-- AC-ADM-09 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): quitar un pedido
-- de una ruta desde /arreglar, con motivo escrito y su evento.
--
-- Por qué hace falta una migración (nota de archivo del plan, línea ~393): reusar
-- 'rechazada' mentiría — esa la reserva un rechazo REAL del cliente en el POD (AC-POD-05,
-- catálogo cerrado de motivos) — y violaría la regla transversal de la sección
-- (append-only: nada se sobrescribe, cada estado cuenta su propia historia). Y
-- pan.ruta_paradas solo tiene grant `insert, update` (0004) — nunca `delete` — así que
-- "quitar" no puede ser un DELETE tampoco. Hace falta un estado nuevo, cerrado en el
-- mismo CHECK que ya vive ahí.
alter table pan.ruta_paradas
  drop constraint ruta_paradas_estado_check,
  add constraint ruta_paradas_estado_check
    check (estado in ('pendiente', 'entregada', 'rechazada', 'quitada'));

-- El repartidor deja de verla: `GET /api/rutas/mi-ruta` lista TODAS las paradas sin
-- filtrar por estado (nota de archivo del plan) — una parada quitada no es una parada
-- pendiente, entregada ni rechazada; es una que no corresponde ver.
-- (El filtro real vive en el SELECT del endpoint, apps/kilopan/src/app/api/rutas/
-- mi-ruta/route.ts — no hay vista ni función que envolver acá.)

-- Un POD que llegó offline y encolado para una parada que el admin quitó mientras el
-- repartidor no tenía señal no debe poder cerrarla: sin este filtro, `POST /api/sync`
-- la marcaría 'entregada' igual, evadiendo por completo el filtro de mi-ruta de arriba
-- (el sync nunca pasa por ese SELECT). Ver apps/kilopan/src/app/api/sync/route.ts.
-- (Mismo motivo: el filtro real vive en el SELECT del endpoint, no acá.)

-- El trigger del art. 55 DL 825 (0004, con el filtro de tipo_dte que agregó 0019) cuenta
-- paradas sin DTE sobre TODAS las paradas de la ruta sin filtrar por estado: una parada
-- quitada por error, sin guía asociada, no puede seguir bloqueando "Salir a ruta" — ya no
-- viaja pan con ella. Se parte de la definición VIGENTE (0019), no de la original de 0004
-- — sobreescribir 0019 habría revivido el hueco de la nota de crédito (61) que esa
-- migración cerró (P0-5, verificado por test-invariantes.mjs: sin este cuidado, una NC
-- asociada al pedido volvía a habilitar la ruta).
create or replace function pan.trg_ruta_exige_dte() returns trigger
language plpgsql as $$
declare
  sin_dte integer;
begin
  if new.estado = 'en_curso' and old.estado is distinct from 'en_curso' then
    select count(*) into sin_dte
      from pan.ruta_paradas rp
     where rp.ruta_id = new.id
       and rp.estado <> 'quitada'
       and not exists (
         select 1 from pan.documento_tributario d
          where d.pedido_id = rp.pedido_id
            and d.estado = 'registrado'
            and d.tipo_dte in (33, 39, 52) -- factura, boleta o guía; NUNCA nota de crédito (61)
       );
    if sin_dte > 0 then
      raise exception 'no se puede salir a ruta: % pedido(s) sin DTE asociado (art. 55 DL 825)', sin_dte;
    end if;
  end if;
  return new;
end;
$$;

-- Reversión:
-- create or replace function pan.trg_ruta_exige_dte() returns trigger
-- language plpgsql as $$
-- declare
--   sin_dte integer;
-- begin
--   if new.estado = 'en_curso' and old.estado is distinct from 'en_curso' then
--     select count(*) into sin_dte
--       from pan.ruta_paradas rp
--      where rp.ruta_id = new.id
--        and not exists (
--          select 1 from pan.documento_tributario d
--           where d.pedido_id = rp.pedido_id
--             and d.estado = 'registrado'
--             and d.tipo_dte in (33, 39, 52)
--        );
--     if sin_dte > 0 then
--       raise exception 'no se puede salir a ruta: % pedido(s) sin DTE asociado (art. 55 DL 825)', sin_dte;
--     end if;
--   end if;
--   return new;
-- end;
-- $$;
-- alter table pan.ruta_paradas
--   drop constraint ruta_paradas_estado_check,
--   add constraint ruta_paradas_estado_check
--     check (estado in ('pendiente', 'entregada', 'rechazada'));
