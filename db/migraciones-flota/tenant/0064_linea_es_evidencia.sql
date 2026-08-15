-- 0064 — Línea=evidencia: unicidad, bloqueo por supersede y por excursión. [AC-FTAR-04]
--
-- Fuente: §3.E1.9 (cada línea referencia exactamente UNA evidencia, `UNIQUE(tenant, tipo, id)`)
-- · §4.5 (el devengo solo lee evidencia VIGENTE: `cerrada AND supersede IS NULL`) · §4.7 (undo
-- post-replay: supersede DESPUÉS de devengada la línea) · §4.9 (gancho `excursion`, vivo pero
-- inerte sin `alarm_rules` sembradas) · §9.3.7 (centinela 7: 0 líneas huérfanas, la segunda
-- línea sobre la misma evidencia viola el UNIQUE, la excursión bloquea y jamás crea ni borra).
--
-- ─── LA UNICIDAD ES UN CONSTRAINT DE VERDAD, NO SOLO EL DEDUP DE `devengar_entrega()` ───────
--
-- La 0063 ya hace que devengar dos veces la misma evidencia devuelva la línea existente en vez
-- de insertar una segunda — pero eso es disciplina DENTRO de la función. El `UNIQUE(tenant_id,
-- evidencia_tipo, evidencia_id)` de acá es el candado que sostiene esa disciplina aunque la
-- función cambie mañana: sin él, un bug en `devengar_entrega()` cobraría dos veces la misma
-- entrega y nadie lo vería hasta la reclamación del cliente.
--
-- ─── POR QUÉ EL BLOQUEO POST-DEVENGO ES UN TRIGGER SOBRE `entregas_pod`, NO SOBRE LA LÍNEA ──
--
-- La corrección del POD (§4.7, undo post-replay) es una fila NUEVA en `entregas_pod` con
-- `supersede_id` apuntando a la vigente anterior — eso ya lo garantiza el write-once de la
-- 0055. Lo que faltaba es que ESE insert, cuando la evidencia que corrige ya fue devengada,
-- deje la línea en un estado que explique por qué su monto ya no es confiable: `bloqueada` +
-- una fila en `review_queue` (supuesto operativo, Pregunta 11 de la spec — la resolución final
-- no está cerrada, pero «bloquear y avisar» es la conducta que el §9.3.7 exige y no revienta el
-- devengo de nadie más).
--
-- ─── LA EXCURSIÓN NO TIENE FK A LA EVIDENCIA, Y NO LA NECESITA ──────────────────────────────
--
-- `excursion` (0007, AC-FTEN-15) es derivada de `reading`, y `reading.parada_id` es el único
-- punto de contacto que el esquema le da con el mundo de la entrega: una excursión de frío
-- detectada en la MISMA parada que el POD es la que blinda el devengo de esa entrega. No hace
-- falta una columna nueva ni una FK: el join reading→parada ya existe desde la 0006.

alter table liquidacion_lineas
  add constraint liquidacion_lineas_evidencia_unica unique (tenant_id, evidencia_tipo, evidencia_id);

comment on constraint liquidacion_lineas_evidencia_unica on liquidacion_lineas is
  'Cada línea nace de UNA evidencia (§3.E1.9): la segunda línea sobre el mismo (tipo, id) '
  'viola este UNIQUE, sea cual sea el bug que la intente [AC-FTAR-04].';

/**
 * Cuando una evidencia YA DEVENGADA queda supersedida (§4.7), la línea que nació de ella queda
 * bloqueada y entra a «Por revisar» — jamás se recalcula ni se borra sola (§9.3.7, Pregunta 11
 * de la spec 06: la resolución final la decide el dueño; acá solo se deja constancia).
 *
 * AFTER INSERT y no BEFORE: el write-once de `entregas_pod` ya decidió si la fila entra: este
 * trigger reacciona a un hecho consumado, no lo condiciona. `not found` cubre el caso normal
 * —la evidencia corregida nunca se había devengado— sin que eso sea un error.
 */
create or replace function bloquear_linea_por_supersede_de_pod() returns trigger
  language plpgsql as $$
  declare
    v_linea liquidacion_lineas;
  begin
    if new.supersede_id is null then
      return new;
    end if;

    select * into v_linea from liquidacion_lineas
     where evidencia_tipo = 'entrega_pod' and evidencia_id = new.supersede_id;
    if not found or v_linea.bloqueada then
      return new;
    end if;

    update liquidacion_lineas set bloqueada = true where id = v_linea.id;

    insert into review_queue (origen, severidad, nota) values (
      'liquidacion.linea_bloqueada',
      'media',
      format(
        'La línea %s de la liquidación %s quedó bloqueada: su evidencia (entrega_pod %s) fue '
        'supersedida con motivo «%s» después de devengada (§4.7, AC-FTAR-04, Pregunta 11).',
        v_linea.id, v_linea.liquidacion_id, new.supersede_id, coalesce(new.supersede_motivo, '')
      )
    );

    return new;
  end;
  $$;

comment on function bloquear_linea_por_supersede_de_pod() is
  'Supersede de un POD ya devengado (§4.7) ⇒ su línea queda bloqueada + fila en review_queue. '
  'Jamás recalcula ni borra la línea (§9.3.7, Pregunta 11) [AC-FTAR-04].';

create trigger entregas_pod_bloquea_linea_al_superseder
  after insert on entregas_pod
  for each row execute function bloquear_linea_por_supersede_de_pod();

/**
 * El devengo (§7.5, §3.E1.9), con el bloqueo por evidencia supersedida y por excursión del
 * §4.9/§9.3.7 agregados:
 *
 *   · evidencia no vigente ⇒ NULL, sin línea. «Vigente» es DOBLE, no solo `supersede_id IS
 *     NULL` sobre la fila propia (eso solo descarta pasar directamente el id de una fila que
 *     YA ES una corrección): también hay que seguir la cadena y comprobar que NADA la haya
 *     supersedido a ELLA — sin la segunda mitad, un POD supersedido ANTES del devengo seguiría
 *     devengando si alguien llamara con el id de la fila ORIGINAL (AC-FTAR-04, §4.5);
 *   · línea ya existente para esa evidencia ⇒ se devuelve, no se duplica (el UNIQUE de arriba
 *     es el backstop si esta rama tuviera un bug) — YA estaba en la 0063;
 *   · excursión de frío en la MISMA parada del POD ⇒ NULL, sin línea: BLOQUEA la creación, y
 *     como jamás se llega a insertar, tampoco hay nada que borrar (§9.3.7) — NUEVO en AC-FTAR-04;
 *   · sin tarifa vigente ⇒ NULL, sin línea — YA estaba en la 0063 (Pregunta 8).
 */
create or replace function devengar_entrega(p_entrega_pod_id uuid, p_liquidacion_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_pod           entregas_pod;
    v_empresa       uuid;
    v_comuna        text;
    v_tarifa        tarifas;
    v_modificadores bigint;
    v_monto         bigint;
    v_linea         uuid;
  begin
    select * into v_pod from entregas_pod where id = p_entrega_pod_id;
    if not found or not v_pod.cerrada or v_pod.supersede_id is not null then
      return null;
    end if;
    if exists (select 1 from entregas_pod where supersede_id = v_pod.id) then
      return null;
    end if;
    -- `por_entrega` se devenga sobre el encargo ENTREGADO (§3 de la spec 06). La no-entrega
    -- tiene su propio concepto (`por_intento_fallido`) y su propia regla, que no es esta.
    if v_pod.resultado not in ('exito', 'parcial') then
      return null;
    end if;

    select id into v_linea from liquidacion_lineas
     where evidencia_tipo = 'entrega_pod' and evidencia_id = v_pod.id;
    if found then
      return v_linea;
    end if;

    -- Excursión en la misma parada (§4.9, §9.3.7): BLOQUEA la creación, no la borra —porque
    -- nunca llega a existir. `reading.parada_id` es el único punto de contacto entre la serie
    -- de frío y la entrega; sin excursiones sembradas (E1 sin alarm_rules activas) esta consulta
    -- es siempre vacía y el gancho queda inerte, como el resto del §4.9.
    if exists (
      select 1 from excursion x join reading r on r.id = x.reading_id
       where r.parada_id = v_pod.parada_id
    ) then
      return null;
    end if;

    select e.empresa_cliente_id, d.comuna into v_empresa, v_comuna
      from encargos e join destinos d on d.id = e.destino_id
     where e.id = v_pod.encargo_id;

    v_tarifa := tarifa_vigente_al(v_empresa, 'por_entrega', v_pod.event_time);
    if v_tarifa.id is null then
      return null;
    end if;

    v_modificadores :=
      modificadores_de_entrega(v_empresa, v_comuna, v_pod.event_time, v_pod.tz_offset_min);
    -- `round_clp()` es la ÚNICA forma de llegar a un peso en esta base (§0, §4.8), y se llama
    -- aunque los dos sumandos ya sean enteros: el día que un modificador sea un porcentaje, el
    -- redondeo ya está donde tiene que estar y no hay una segunda regla que descubrir.
    v_monto := round_clp((v_tarifa.precio_clp + v_modificadores)::numeric);

    perform set_config('app.devengo_en_curso', 'si', true);
    insert into liquidacion_lineas (
      liquidacion_id, empresa_cliente_id, evidencia_tipo, evidencia_id, concepto, tarifa_id,
      cantidad, precio_base_clp, modificadores_clp, monto_clp
    ) values (
      p_liquidacion_id, v_empresa, 'entrega_pod', v_pod.id, 'por_entrega', v_tarifa.id,
      1, v_tarifa.precio_clp, v_modificadores, v_monto
    ) returning id into v_linea;
    perform set_config('app.devengo_en_curso', '', true);

    return v_linea;
  end;
  $$;

comment on function devengar_entrega(uuid, uuid) is
  'EL devengo (§7.5): la ÚNICA función que crea líneas de liquidación. Monto en CLP entero '
  'calculado en la BD con `round_clp()`, contra la tarifa vigente al `event_time` de la '
  'evidencia (§3.E1.8). Devuelve NULL cuando no corresponde crear línea: evidencia no vigente, '
  'excursión en la parada (§4.9), o sin tarifa (AC-FTAR-04).';

-- El oráculo del centinela 7 (§9.3.7): 0 líneas huérfanas. «Huérfana» se define
-- OPERATIVAMENTE (única lectura no trivial posible con evidencia append-only + FK compuesta,
-- Pregunta 11 de la spec): una línea cuya evidencia referenciada quedó supersedida y la línea
-- NO quedó marcada `bloqueada`. Con el trigger de arriba sosteniendo la invariante, esta vista
-- es la comprobación independiente de que sostiene de verdad sobre datos reales — no una
-- tautología del mismo código que la escribe.
create or replace view liquidacion_lineas_huerfanas as
  select l.*
    from liquidacion_lineas l
    join entregas_pod p on l.evidencia_tipo = 'entrega_pod' and p.id = l.evidencia_id
   where not l.bloqueada
     and exists (select 1 from entregas_pod s where s.supersede_id = p.id);

comment on view liquidacion_lineas_huerfanas is
  'Líneas cuya evidencia quedó supersedida sin que la línea se marcara `bloqueada` (§9.3.7). '
  'Vacía siempre que el trigger de supersede sostenga la invariante [AC-FTAR-04].';
