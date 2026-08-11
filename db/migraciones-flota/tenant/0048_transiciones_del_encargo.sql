-- 0048 — quién puede mover el encargo, y desde qué hecho. [AC-FRUT-03]
--
-- La 0047 agregó los cuatro estados que faltaban. Acá va la parte que importa: QUIÉN los
-- estampa. La máquina que Alexis fijó el 11-ago-2026 es
--
--     solicitado → aceptado → asignado → publicado → entregado | no_entregado
--
-- y de sus cinco transiciones la app escribe UNA sola —la aceptación, que es un acto humano del
-- operador y no se deriva de ningún hecho—. Las otras cuatro las estampa un trigger desde el
-- hecho que las produce: el ítem que entra en una parada, la ruta que se publica, la parada que
-- se cierra en terreno.
--
-- ─── POR QUÉ LOS FINALES SON «SOLO POR TRIGGER» (§4.5) ─────────────────────────────
--
-- `entregado` es la palabra con la que se cobra (módulo 06: las líneas de liquidación nacen de
-- las evidencias de custodia y cierre). Un `entregado` que la app pudiera estampar con un UPDATE
-- sería un encargo dado por cumplido sin que nadie hubiera capturado nada en terreno —y la
-- diferencia entre «lo dice el sistema» y «lo dice la evidencia» es justo lo que se discute
-- cuando el contratante reclama—. Por eso la guarda no es un `if` en TypeScript: un `if` protege
-- hasta que alguien escriba la segunda ruta HTTP que toca la tabla.
--
-- ─── CÓMO SE DISTINGUE UN TRIGGER DE LA APP, SIN INVENTAR UN SECRETO ───────────────
--
-- `pg_trigger_depth()`. Dentro de la guarda vale 1 cuando el UPDATE lo mandó la app y ≥2 cuando
-- lo mandó otro trigger. No hay GUC que el rol de app pudiera fijar para hacerse pasar por la
-- base, ni una bandera que alguien copie de otro handler «porque ahí funcionaba».

create or replace function encargo_guarda_de_estados() returns trigger
  language plpgsql as $$
  declare
    v_finales constant text[] := array['entregado', 'no_entregado'];
    v_cambio_de_estado constant boolean := new.estado::text is distinct from old.estado::text;
  begin
    -- Un final es FINAL. Reabrirlo borraría el día en que el cliente no recibió, que es
    -- exactamente el dato de la disputa; el reintento es un encargo NUEVO (§4.5, §6).
    if old.estado::text = any (v_finales) and v_cambio_de_estado then
      raise exception
        'el encargo % ya cerró como «%»: un estado final no se reabre. Reintentar es crear un '
        'encargo NUEVO con `reintento_de` apuntando a este (§4.5, §6).', old.id, old.estado
        using errcode = 'insufficient_privilege';
    end if;

    -- Los finales SOLO los estampa un trigger, desde el hecho que los produce (§4.5).
    if new.estado::text = any (v_finales) and v_cambio_de_estado and pg_trigger_depth() < 2 then
      raise exception
        'el estado final «%» no se escribe: lo estampa el cierre de la parada que lo produjo '
        '(§4.5). Un encargo entregado sin captura de terreno es lo que se cobra sin evidencia.',
        new.estado
        using errcode = 'insufficient_privilege';
    end if;

    -- Editable por su creador SOLO hasta la aceptación (§3.E1.10). La mitad «su creador» la
    -- verifica la app, que es la única que sabe qué usuario pregunta; las dos mitades de
    -- «hasta cuándo» van acá porque son el invariante, y son DOS porque el §3.E1.10 habla del
    -- CONTRATANTE:
    --
    --   · para el rol `cliente`, la ventana se cierra con la aceptación del operador. Es su
    --     regla, literal: pidió, la casa se comprometió, y de ahí en adelante corrige por
    --     teléfono. El rol sale del mismo GUC con el que la 0040 lo confina a su empresa.
    --   · para cualquiera —la casa incluida—, el payload se congela cuando el encargo SALE DE
    --     LA BANDEJA hacia una ruta. Ese es el momento en que cambiarle el destino o los
    --     bultos manda el camión a otra cuadra, y no la aceptación: un encargo que el operador
    --     dio de alta con un dígito de más y que todavía no armó en ninguna ruta se corrige,
    --     que es exactamente lo que el §5.2 F1 le pide hacer en la bandeja.
    --
    -- Es PLANIFICACIÓN: rebota con 0 filas y nadie perdió un hecho del mundo (§4.2).
    if (
         new.empresa_cliente_id is distinct from old.empresa_cliente_id
      or new.destino_id         is distinct from old.destino_id
      or new.cargo_type_id      is distinct from old.cargo_type_id
      or new.bultos             is distinct from old.bultos
      or new.attrs              is distinct from old.attrs
      or new.fecha_servicio     is distinct from old.fecha_servicio
    ) then
      if old.estado::text <> 'solicitado'
         and nullif(current_setting('app.current_role', true), '') = 'cliente' then
        raise exception
          'el encargo % ya está «%»: la ventana de edición del contratante se cierra con la '
          'aceptación del operador (§3.E1.10).', old.id, old.estado
          using errcode = 'check_violation';
      end if;

      if old.estado::text = any (array['asignado', 'publicado', 'entregado', 'no_entregado']) then
        raise exception
          'el encargo % ya está «%»: la ventana de edición se cerró cuando entró en una ruta. '
          'Sacalo de la ruta primero (§3.E1.10, §5.2 F1).', old.id, old.estado
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end
  $$;

comment on function encargo_guarda_de_estados() is
  'Las guardas de la máquina de estados del encargo [AC-FRUT-03]: un final no se reabre y '
  'solo lo estampa un trigger (42501); el payload deja de ser editable para el contratante '
  'con la aceptación y para todos cuando el encargo entra en una ruta (23514). '
  '§4.5, §3.E1.10, §4.2.';

create trigger encargos_guarda_de_estados
  before update on encargos
  for each row execute function encargo_guarda_de_estados();

-- ─── `aceptado → asignado`: el ítem que entra en una parada ─────────────────────────
--
-- El seguimiento de ruta va EN el encargo por decisión del dueño, así que la transición la
-- escribe el mismo acto que la produce y no un job que compare tablas cada tanto. Y de paso
-- queda cerrado el orden de la máquina: un encargo que el contratante pidió y que la casa
-- todavía no miró no se puede meter en una ruta.

create or replace function encargo_asignado_por_item() returns trigger
  language plpgsql as $$
  declare
    v_estado text;
  begin
    select estado::text into v_estado from encargos where id = new.encargo_id;

    if v_estado = 'solicitado' then
      raise exception
        'el encargo % está «solicitado»: la casa todavía no lo aceptó y no puede entrar en una '
        'ruta (§3.E1.10). Aceptarlo es el paso que falta.', new.encargo_id
        using errcode = 'check_violation';
    end if;

    if v_estado = 'aceptado' then
      update encargos set estado = 'asignado'::encargo_estado where id = new.encargo_id;
    end if;
    return null;
  end
  $$;

create trigger items_asignan_su_encargo
  after insert on items
  for each row execute function encargo_asignado_por_item();

-- Y la vuelta: un encargo que se queda sin ítems volvió a la bandeja. Pasa cuando se borra la
-- ruta del día (las paradas y sus ítems caen en cascada) y va a volver a pasar con el ítem que
-- se baja del manifiesto sin DTE (AC-FRUT-24). Sin esta mitad, un encargo quedaría «asignado»
-- para siempre a una ruta que ya no existe y el operador no podría replanificarlo.
create or replace function encargo_devuelto_a_la_bandeja() returns trigger
  language plpgsql as $$
  begin
    if exists (select 1 from items where encargo_id = old.encargo_id) then
      return null;
    end if;
    update encargos set estado = 'aceptado'::encargo_estado
      where id = old.encargo_id and estado::text in ('asignado', 'publicado');
    return null;
  end
  $$;

create trigger items_devuelven_su_encargo
  after delete on items
  for each row execute function encargo_devuelto_a_la_bandeja();

-- ─── `asignado → publicado`: publicar el día ────────────────────────────────────────
--
-- El mismo momento que congela `promesa_original` y fija `rutas.version` (§5.2 F1, AC-FRUT-05).
-- Se engancha al hecho —`publicada_en` pasando de NULL a un momento— y no al handler que hoy lo
-- escribe, para que la segunda vía de publicación que alguien agregue mañana lo herede sola.

create or replace function encargos_publicados_por_ruta() returns trigger
  language plpgsql as $$
  begin
    if old.publicada_en is not null or new.publicada_en is null then return null; end if;

    update encargos e set estado = 'publicado'::encargo_estado
      from items i
      join paradas p on p.id = i.parada_id
     where i.encargo_id = e.id and p.ruta_id = new.id and e.estado::text = 'asignado';
    return null;
  end
  $$;

create trigger rutas_publican_sus_encargos
  after update on rutas
  for each row execute function encargos_publicados_por_ruta();

-- ─── `publicado → entregado | no_entregado`: la parada que se cierra ────────────────
--
-- EL trigger del «finales solo-por-trigger» del §4.5. El hecho que lo produce es el cierre de
-- la parada de ENTREGA con su resultado, que escribe el terreno por el módulo 04 (§4.5): hasta
-- que eso ocurra, ningún camino de la app puede dejar un encargo en entregado.
--
-- Con resultado `parcial` la decisión se toma POR ÍTEM y no por parada: la entrega parcial es de
-- primera clase por ítem (§3.E1.5), y una parada parcial es justamente aquella en la que a un
-- encargo le entregaron y a otro no. Marcar los dos igual sería inventar el dato que el módulo
-- 06 después cobra.

create or replace function encargos_cerrados_por_parada() returns trigger
  language plpgsql as $$
  begin
    if new.tipo::text <> 'entrega' then return null; end if;
    if new.resultado is null then return null; end if;
    if old.resultado is not distinct from new.resultado
       and old.estado::text is not distinct from new.estado::text then return null; end if;

    update encargos e
       set estado = (case
             when new.resultado::text = 'exito' then 'entregado'
             when new.resultado::text = 'fallo' then 'no_entregado'
             when coalesce(i.qty_entregada, 0) > 0 then 'entregado'
             else 'no_entregado'
           end)::encargo_estado
      from items i
     where i.encargo_id = e.id and i.parada_id = new.id
       and e.estado::text not in ('entregado', 'no_entregado');
    return null;
  end
  $$;

create trigger paradas_cierran_sus_encargos
  after update on paradas
  for each row execute function encargos_cerrados_por_parada();

-- Cada transición queda en `audit_trail` con su antes y su después por el trigger `auditar()`
-- que la 0036 ya le puso a `encargos` (§4.6): el rastro append-only de la máquina existe sin
-- que este archivo tenga que duplicarlo. Los eventos de acto humano —los tres de abajo— sí van
-- al catálogo, porque los emite la app con su actor y su dispositivo.
insert into evento_tipo (codigo, descripcion) values
  ('encargo.aceptado',    'El operador aceptó un encargo del contratante y cerró su ventana de edición'),
  ('encargo.editado',     'El contratante corrigió su encargo antes de que la casa lo aceptara'),
  ('encargo.reintentado', 'Se creó un encargo NUEVO que reintenta uno que no se entregó');
