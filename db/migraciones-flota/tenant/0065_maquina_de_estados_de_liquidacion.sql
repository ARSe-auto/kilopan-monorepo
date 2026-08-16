-- 0065 — La máquina de estados de la liquidación: abierta→cerrada→pagada, de a una y hacia
-- adelante. [AC-FTAR-05]
--
-- Fuente: §3.E1.9 (estados `abierta→cerrada→pagada`) · §4.6 (toda transición emite evento
-- append-only + audit_trail; el estado visible es proyección, jamás contador mutable) · §2
-- (la misma regla general de la máquina del encargo, 0047/0048).
--
-- ─── POR QUÉ ES UN TRIGGER DE BD Y NO UNA RUTA HTTP ─────────────────────────────────────────
--
-- Igual que AC-FTAR-01 a 04, este AC no toca `apps/flota`: su oráculo es CI (pgTAP), no e2e.
-- La ruta que el operador va a apretar para «Cerrar» y «Marcar pagada» es trabajo de una spec
-- de UI posterior (§9, drill-down y paneles) — acá solo se deja el invariante que esa ruta,
-- cuando exista, no va a poder saltarse: un UPDATE de `estado` que no sea exactamente
-- `abierta→cerrada` o `cerrada→pagada` rebota, venga de donde venga.
--
-- ─── DOS GUARDIAS DISTINTOS, PORQUE SON DOS INVARIANTES DISTINTOS ───────────────────────────
--
-- (a) `liquidacion_guarda_de_estados()` — BEFORE UPDATE en `liquidaciones`: valida la
--     transición de la MÁQUINA. Un salto (`abierta→pagada`) o un retroceso
--     (`pagada→cerrada`, `cerrada→abierta`) rebota con `check_violation` (422 tipado, §4.2) y
--     dEja la fila intacta — el mismo SQLSTATE que usa toda esta spec para vigencia solapada
--     (AC-FTAR-02) y para el tope de conceptos (AC-FTAR-01).
-- (b) La extensión de `solo_el_devengo_crea_lineas()` (0063) — BEFORE INSERT en
--     `liquidacion_lineas`: valida que la liquidación DESTINO esté `abierta`. «Cerrada congela
--     líneas y totales» (§3.E1.9) es literal: ni siquiera `devengar_entrega()`, que corre
--     `SECURITY DEFINER`, puede colar una línea nueva en una liquidación ya cerrada — el AC lo
--     pide como rebote 422 y no como degradación silenciosa («nueva línea sobre `cerrada` ⇒
--     422 y 0 cambios», texto literal del criterio), así que es un `RAISE`, no el patrón
--     `return null` que usan las demás ramas de esa función para «no corresponde crear línea».
--
-- ─── EL EVENTO SE EMITE POR TRIGGER, EL AUDIT_TRAIL YA EXISTÍA ──────────────────────────────
--
-- La 0063 ya enganchó `liquidaciones` a `auditar()` (AFTER INSERT OR UPDATE OR DELETE): cada
-- transición de estado YA queda en `audit_trail` con su antes y su después sin que este archivo
-- tenga que duplicarlo. Lo que faltaba es el EVENTO append-only (§4.6: «toda transición de
-- estado emite evento… secuencia monotónica por tenant»), que es una fuente distinta —
-- `eventos`, no `audit_trail`— y que el resto del producto (paneles, señal roja de Caja) puede
-- leer sin tener que interpretar un JSON de auditoría genérico.
--
-- `tz_offset_min` NO se deja en 0 «porque es del servidor»: el mismo comentario que
-- `offsetChileMin()` deja en `gobierno.ts` para el resto de los actos de gobierno aplica acá
-- —un evento de gobierno en enero (verano, UTC-3) leído con offset 0 se ve cuatro horas más
-- tarde de lo que fue—. Sin capa de app en este AC, el trigger resuelve el mismo huso
-- `America/Santiago` que ya usa toda la base (vencimientos de documentos, EEVD semanal) contra
-- la base de datos de husos del sistema, para que la app, cuando exista, lea el mismo número
-- que hubiera calculado ella misma.

create or replace function liquidacion_guarda_de_estados() returns trigger
  language plpgsql as $$
  begin
    if new.estado is not distinct from old.estado then
      return new;
    end if;

    if not (
      (old.estado = 'abierta' and new.estado = 'cerrada') or
      (old.estado = 'cerrada' and new.estado = 'pagada')
    ) then
      raise exception
        'la liquidación % no pasa de «%» a «%»: la máquina abierta→cerrada→pagada avanza SOLO '
        'hacia adelante y de a una (§3.E1.9, AC-FTAR-05).', old.id, old.estado, new.estado
        using errcode = 'check_violation';
    end if;

    return new;
  end;
  $$;

comment on function liquidacion_guarda_de_estados() is
  'Guarda de la máquina de la liquidación (§3.E1.9, AC-FTAR-05): salto o retroceso ⇒ '
  'check_violation (422) y 0 cambios. Las dos únicas transiciones válidas son '
  'abierta→cerrada y cerrada→pagada, una por UPDATE.';

create trigger liquidaciones_guarda_de_estados
  before update on liquidaciones
  for each row execute function liquidacion_guarda_de_estados();

/**
 * Cada transición de estado VÁLIDA (la guarda de arriba ya descartó la inválida) emite su
 * evento append-only (§4.6): tipo catalogado, secuencia monotónica de `eventos` — nada de esto
 * lo inventa este trigger, ya lo sostiene el esquema de la 0002.
 *
 * `is not distinct from` como guarda de entrada: un UPDATE que toca otra columna sin tocar
 * `estado` no es una transición y no emite nada.
 */
create or replace function liquidacion_emitir_evento_de_estado() returns trigger
  language plpgsql as $$
  declare
    v_tipo_id uuid;
    v_ahora   timestamptz := now();
  begin
    if new.estado is not distinct from old.estado then
      return null;
    end if;

    select id into v_tipo_id from evento_tipo where codigo = 'liquidacion.' || new.estado;
    if not found then
      raise exception
        'evento_tipo sin código «liquidacion.%»: la máquina de estados y el catálogo de '
        'eventos se desincronizaron (AC-FTAR-05).', new.estado;
    end if;

    insert into eventos (
      tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min, payload
    ) values (
      v_tipo_id, 'liquidaciones', new.id, v_ahora,
      (extract(epoch from
         (v_ahora at time zone 'America/Santiago') - (v_ahora at time zone 'UTC')
       ) / 60)::int,
      jsonb_build_object('desde', old.estado, 'hacia', new.estado)
    );

    return null;
  end;
  $$;

comment on function liquidacion_emitir_evento_de_estado() is
  'Emite el evento append-only de cada transición de estado de la liquidación (§4.6, '
  'AC-FTAR-05): `liquidacion.cerrada` o `liquidacion.pagada`, con el huso de Chile resuelto '
  'contra la base de datos de husos del sistema (jamás 0 fijo).';

create trigger liquidaciones_emiten_evento_de_estado
  after update on liquidaciones
  for each row execute function liquidacion_emitir_evento_de_estado();

insert into evento_tipo (codigo, descripcion) values
  ('liquidacion.cerrada', 'La liquidación pasó de abierta a cerrada: foto estable, habilita disputa y folio'),
  ('liquidacion.pagada',  'El operador registró el pago de la liquidación cerrada');

/**
 * «Cerrada congela líneas y totales» (§3.E1.9, AC-FTAR-05), literal: ni siquiera el devengo
 * `SECURITY DEFINER` puede insertar una línea en una liquidación que no esté `abierta`. Se
 * agrega ACÁ, dentro del mismo guardarraíl de «solo el devengo crea líneas» (0063), para que
 * quien lea esa función encuentre las dos condiciones de una vez: quién puede insertar
 * (`app.devengo_en_curso`) y EN QUÉ ESTADO puede hacerlo.
 */
create or replace function solo_el_devengo_crea_lineas() returns trigger
  language plpgsql as $$
  declare
    v_estado text;
  begin
    if nullif(current_setting('app.devengo_en_curso', true), '') is distinct from 'si' then
      raise exception
        'liquidacion_lineas no acepta INSERT directo (§3.E1.9, §7.5): las líneas las crea '
        'devengar_entrega(), la única función del devengo'
        using errcode = 'insufficient_privilege';
    end if;

    select estado into v_estado from liquidaciones where id = new.liquidacion_id;
    if v_estado is distinct from 'abierta' then
      raise exception
        'la liquidación % está «%»: solo «abierta» acepta líneas nuevas — «cerrada» congela '
        'líneas y totales (§3.E1.9, AC-FTAR-05).', new.liquidacion_id, coalesce(v_estado, '¿inexistente?')
        using errcode = 'check_violation';
    end if;

    return new;
  end;
  $$;

comment on function solo_el_devengo_crea_lineas() is
  'Cero líneas manuales (§3.E1.9, §7.5) Y cero líneas sobre liquidación no-abierta (AC-FTAR-05): '
  'INSERT sin `app.devengo_en_curso` ⇒ 42501; INSERT contra liquidación `cerrada` o `pagada` ⇒ '
  '422 (check_violation), aunque venga de adentro del devengo.';
