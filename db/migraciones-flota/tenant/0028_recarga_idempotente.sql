-- 0028 — El cierre idempotente de la recarga, para quien no puede ver montos. [AC-FVEH-08]
--
-- Va en una migración propia y no dentro de la 0027 porque la 0027 ya se había aplicado, y el
-- runner frena por sha a quien edita una migración viva. Tiene razón: una migración aplicada no
-- se edita, se escribe otra.

/**
 * El cierre idempotente de una sesión de recarga, para el rol que NO puede ver montos.
 *
 * ─── POR QUÉ HACE FALTA UNA FUNCIÓN Y NO ALCANZA EL `INSERT … ON CONFLICT` ─────────
 *
 * La RLS del §4.8 le niega al chofer el SELECT sobre esta tabla, y `ON CONFLICT DO NOTHING`
 * necesita LEER la fila en conflicto para saber que ya está. Con el `app.current_role` en
 * `chofer`, ese insert rebota con «new row violates row-level security policy» — o sea: el
 * replay del outbox del chofer FALLARÍA, que es exactamente lo que el §4.2 prohíbe con todas
 * las letras. No es una hipótesis: se descubrió corriendo la suite con el rol de app real.
 *
 * `SECURITY DEFINER` resuelve el conflicto entre las dos reglas sin ablandar ninguna: la
 * función corre con los privilegios del dueño del esquema, así que puede resolver la
 * idempotencia, y devuelve SOLO el id — ni un peso sale por acá. El chofer sigue sin poder
 * leer un monto por ningún camino, y su captura sigue sin rebotar nunca.
 *
 * Es la misma técnica que el §4.5 usa para la ecuación de custodia de `cierres_ruta`.
 *
 * `search_path` fijo y explícito: una función SECURITY DEFINER sin él es la vía clásica para
 * que alguien con `CREATE` en otro esquema le cambie qué tabla ve (§7.2).
 */
create or replace function registrar_recarga(
  p_vehiculo uuid, p_turno uuid, p_wh int, p_soc_inicial smallint, p_soc_final smallint,
  p_ts timestamptz, p_tz_offset int, p_client_uuid uuid
) returns table (id uuid, repetida boolean)
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare
    v_id uuid;
  begin
    insert into energy_entry
      (vehiculo_id, turno_id, type, wh, soc_inicial, soc_final, ts_dispositivo, tz_offset_min, client_uuid)
    values
      (p_vehiculo, p_turno, 'charge', p_wh, p_soc_inicial, p_soc_final, p_ts, p_tz_offset, p_client_uuid)
      on conflict (tenant_id, client_uuid) do nothing
    returning energy_entry.id into v_id;

    if v_id is not null then
      return query select v_id, false;
      return;
    end if;

    -- Ya estaba: el replay del outbox. Se devuelve la MISMA fila, sin volver a escribir nada.
    return query
      select e.id, true from energy_entry e where e.client_uuid = p_client_uuid;
  end
  $$;

comment on function registrar_recarga(uuid, uuid, int, smallint, smallint, timestamptz, int, uuid) is
  'Cierre idempotente de una sesión de recarga (§3.E1.4, §4.2). SECURITY DEFINER porque la RLS '
  'de dinero le niega al chofer el SELECT que `ON CONFLICT` necesita, y su captura JAMÁS puede '
  'rebotar. Devuelve solo el id: ni un peso sale por acá (§4.8).';
