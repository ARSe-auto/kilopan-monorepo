-- 0066 — Disputa por línea: sobre cerrada, dentro de la ventana, motivo tipado, doble-tap
-- deja UNA sola disputa. [AC-FTAR-06]
--
-- Fuente: §3.E1.9 («la disputa se modela sobre la línea: estado, motivo tipado de catálogo,
-- autor, timestamp, client_uuid») · §0 (PLAZOS_LEGALES.disputa_liquidacion_dias) · §4.2 (la
-- validación de catálogo rebota en la BD, 422 tipado) · §9.3.1 (centinela 1: replay del mismo
-- client_uuid ⇒ count(*)=1) · §9.3.3 (centinela 3: rol `cliente` confinado a SU empresa —
-- línea ajena, fila invisible por política de rol) · Anexo B («dinero disputado siempre es
-- rojo»).
--
-- ─── LA DISPUTA VIVE EN LA LÍNEA, NO EN UNA TABLA APARTE ────────────────────────────────────
--
-- El cuerpo de la spec 06 es literal: «la disputa se modela sobre la línea». Cinco columnas
-- nuevas en `liquidacion_lineas` —estado, motivo, nota, autor, timestamp, client_uuid— en vez
-- de una tabla satélite. Es también lo que necesita el semáforo (AC-FSEM-17, ya construido):
-- `evaluarCajaCustodiaLiquidacion` toma una `LineaDisputada` por hecho ya resuelto, y «línea
-- disputada» solo existe como frase si la línea misma lleva su estado.
--
-- ─── POR QUÉ LA FUNCIÓN NO ES `SECURITY DEFINER` ────────────────────────────────────────────
--
-- Al revés que el devengo (§7.5, AC-FTAR-03): acá el confinamiento del rol `cliente` a SU
-- empresa (§9.3.3, `aplicar_rls_de_empresa`, ya aplicada a `liquidacion_lineas` desde la 0063)
-- es EXACTAMENTE la garantía que este AC necesita, y una función `SECURITY DEFINER` la
-- apagaría —correría con los privilegios del dueño del esquema, que no sufre RLS. Con la
-- función corriendo como quien invoca, un `cliente` de la empresa X que apunte a una línea de
-- la empresa Y no la encuentra: la política RESTRICTIVE la hace desaparecer del primer SELECT,
-- y la función devuelve 0 filas — la derivación exacta que pide el §9.3.3 («fila invisible por
-- política de rol», no un 404 de tenant ajeno).
--
-- El UPDATE que sigue tampoco necesita privilegio extra: `liquidacion_lineas` solo tiene el
-- INSERT revocado (§7.5, AC-FTAR-03) — el UPDATE del rol de app sigue intacto.
--
-- ─── IDEMPOTENCIA: LA COLUMNA DE LA LÍNEA, NO `eventos.client_uuid` ─────────────────────────
--
-- `eventos` ya trae su propia columna `client_uuid` con `UNIQUE(tenant_id, client_uuid)` (0002),
-- pero es un espacio de nombres COMPARTIDO por todo el tenant — usarlo acá encadenaría la
-- idempotencia de esta mutación a la de cualquier otra que decida pasar el mismo client_uuid.
-- El §3.E1.9 pide la idempotencia SOBRE LA LÍNEA, así que `disputa_client_uuid` vive en
-- `liquidacion_lineas` con su propio `UNIQUE(tenant_id, disputa_client_uuid)` — mismo criterio
-- que `energy_entry`/`devoluciones`/`entregas_pod`, cada una con la suya.
--
-- ─── UNA DISPUTA POR LÍNEA, NO UNA MÁQUINA DE RESOLUCIÓN ────────────────────────────────────
--
-- La Pregunta 4 de la spec deja abierta la resolución (supersede, ajuste en el período
-- siguiente, si bloquea `pagada`). Este AC construye SOLO el registro: `disputa_estado` nace
-- con un catálogo de una sola fila (`abierta`) a propósito — inventar `resuelta`/`rechazada`
-- ahora sería resolver la Pregunta 4 sin que el dueño la haya cerrado. Un segundo intento de
-- disputa sobre una línea YA disputada (client_uuid distinto) rebota: E1 registra una disputa
-- por línea, no una cola de reclamos.
--
-- ─── LA VENTANA SE MIDE DESDE EL EVENTO `liquidacion.cerrada` (AC-FTAR-05), NO DESDE `creado_en`
--
-- La Pregunta 5 de la spec asume «7 días desde el cierre» como punto de partida operativo. El
-- cierre no tiene su propia columna de timestamp —es una transición de estado, y su fecha
-- autoritativa es el evento append-only que la 0065 ya emite (`liquidacion.cerrada`)—, así que
-- la ventana se ancla ahí: la MISMA fuente que el resto del §4.6 usa para «cuándo pasó».
--
-- `p_ahora` es un parámetro explícito y no un `now()` interno: sin él, un test no podría poner
-- una liquidación «fuera de ventana» sin mover el reloj del servidor — mismo motivo por el que
-- `tarifa_vigente_al` recibe el instante en vez de asumirlo.

alter table liquidacion_lineas
  add column disputa_estado      text,
  add column disputa_motivo_id   uuid,
  add column disputa_nota        text,
  add column disputa_autor_id    uuid,
  add column disputa_creado_en   timestamptz,
  add column disputa_client_uuid uuid;

alter table liquidacion_lineas
  add constraint liquidacion_lineas_disputa_estado_catalogo
    check (disputa_estado in ('abierta')),
  -- Las cinco columnas nacen y mueren juntas: no hay disputa a medias (§4.2, validación de
  -- forma completa, mismo criterio que `usuarios_cliente_con_empresa` de la 0011).
  add constraint liquidacion_lineas_disputa_completa check (
    (disputa_estado is null) = (disputa_motivo_id is null)
    and (disputa_estado is null) = (disputa_autor_id is null)
    and (disputa_estado is null) = (disputa_creado_en is null)
    and (disputa_estado is null) = (disputa_client_uuid is null)
  ),
  add constraint liquidacion_lineas_disputa_motivo_fk
    foreign key (tenant_id, disputa_motivo_id) references motivos (tenant_id, id),
  add constraint liquidacion_lineas_disputa_autor_fk
    foreign key (tenant_id, disputa_autor_id) references usuarios (tenant_id, id),
  -- Centinela 1 (§9.3.1): el replay del mismo `client_uuid` no puede dejar una segunda fila
  -- disputada. Los NULL de las líneas sin disputa no colisionan entre sí (semántica estándar
  -- de UNIQUE en Postgres).
  add constraint liquidacion_lineas_disputa_client_uuid_unico
    unique (tenant_id, disputa_client_uuid);

create index liquidacion_lineas_disputa_estado_idx
  on liquidacion_lineas (tenant_id, disputa_estado)
  where disputa_estado is not null;

comment on column liquidacion_lineas.disputa_estado is
  'NULL = sin disputa. «abierta» = disputada (§3.E1.9, AC-FTAR-06); la señal roja de Caja/'
  'custodia (Anexo B, AC-FSEM-17) la lee de acá. Catálogo de una sola fila a propósito: la '
  'resolución (Pregunta 4 de la spec) no está construida.';

-- El catálogo de motivos de disputa (§4.5, mecanismo de `motivos`: se apagan, jamás DELETE —
-- guardado por `motivos_no_se_borran` desde la 0038). `estado_asociado` los separa de los
-- motivos de parada fallida sin tocar esa tabla ni su siembra por vertical: la disputa de
-- liquidación es del modo DaaS, no de un vertical de reparto.
insert into motivos (codigo, etiqueta, estado_asociado, orden) values
  ('monto_incorrecto',      'Monto incorrecto',            'liquidacion_linea_disputada', 1),
  ('entrega_no_ocurrida',   'La entrega no ocurrió',        'liquidacion_linea_disputada', 2),
  ('evidencia_no_concuerda','La evidencia no concuerda',    'liquidacion_linea_disputada', 3),
  ('otro',                  'Otro motivo',                  'liquidacion_linea_disputada', 4);

insert into evento_tipo (codigo, descripcion) values
  ('liquidacion_linea.disputada', 'El cliente disputó una línea de una liquidación cerrada');

/**
 * Registra la disputa de UNA línea (§3.E1.9, AC-FTAR-06).
 *
 * NO `SECURITY DEFINER`: corre con los privilegios y la RLS de quien llama, a propósito (ver
 * cabecera del archivo). Devuelve 0 filas cuando la línea no existe O cuando la política del
 * rol `cliente` la esconde por ser de otra empresa — el mismo resultado para los dos casos,
 * que es justo la derivación que pide el §9.3.3.
 *
 * Devuelve `repetida = true` sin escribir nada cuando `p_client_uuid` ya es el de la disputa
 * registrada en esa MISMA línea (replay del doble-tap, centinela 1). Rebota con
 * `check_violation` (422) y CERO filas tocadas en cualquier otro caso inválido: liquidación no
 * `cerrada`, fuera de la ventana, motivo ausente o fuera de catálogo, o línea que ya tenía una
 * disputa de un intento distinto.
 */
create or replace function disputar_linea(
  p_linea_id uuid, p_motivo_id uuid, p_nota text, p_autor_id uuid, p_client_uuid uuid,
  p_ahora timestamptz default now()
) returns table (id uuid, repetida boolean)
  language plpgsql as $$
  declare
    v_linea       liquidacion_lineas;
    v_liquidacion liquidaciones;
    v_cerrada_en  timestamptz;
    v_tz_offset   int;
  begin
    select * into v_linea from liquidacion_lineas where liquidacion_lineas.id = p_linea_id;
    if not found then
      return;
    end if;

    if v_linea.disputa_client_uuid is not null and v_linea.disputa_client_uuid = p_client_uuid then
      return query select v_linea.id, true;
      return;
    end if;

    if v_linea.disputa_estado is not null then
      raise exception
        'la línea % ya tiene una disputa registrada: E1 modela una disputa por línea (§3.E1.9, '
        'Pregunta 4, AC-FTAR-06)', p_linea_id
        using errcode = 'check_violation';
    end if;

    select * into v_liquidacion from liquidaciones where liquidaciones.id = v_linea.liquidacion_id;
    if v_liquidacion.estado is distinct from 'cerrada' then
      raise exception
        'la liquidación % está «%»: solo una liquidación cerrada acepta disputas de sus líneas '
        '(§3.E1.9, AC-FTAR-06)', v_liquidacion.id, v_liquidacion.estado
        using errcode = 'check_violation';
    end if;

    select e.event_time into v_cerrada_en
      from eventos e
     where e.objeto_tabla = 'liquidaciones' and e.objeto_id = v_liquidacion.id
       and e.tipo_id = (select evento_tipo.id from evento_tipo where codigo = 'liquidacion.cerrada')
     order by e.event_time desc
     limit 1;

    -- Sin el evento de cierre no hay desde cuándo contar: no se inventa una ventana (mismo
    -- criterio que «sin tarifa vigente» del devengo, AC-FTAR-03).
    if v_cerrada_en is null or p_ahora > v_cerrada_en + interval '7 days' then
      raise exception
        'la disputa de la línea % llegó fuera de la ventana de reclamo (PLAZOS_LEGALES.'
        'disputa_liquidacion_dias, §0, AC-FTAR-06)', p_linea_id
        using errcode = 'check_violation';
    end if;

    if p_motivo_id is null or not exists (
      select 1 from motivos
       where motivos.id = p_motivo_id
         and estado_asociado = 'liquidacion_linea_disputada'
         and activo
    ) then
      raise exception
        'motivo % ausente, apagado o fuera del catálogo de disputas (§4.5, AC-FTAR-06)',
        p_motivo_id
        using errcode = 'check_violation';
    end if;

    update liquidacion_lineas set
      disputa_estado      = 'abierta',
      disputa_motivo_id    = p_motivo_id,
      disputa_nota         = p_nota,
      disputa_autor_id     = p_autor_id,
      disputa_creado_en    = p_ahora,
      disputa_client_uuid  = p_client_uuid
    where liquidacion_lineas.id = p_linea_id;

    -- Huso de Chile resuelto contra la base de husos del sistema, jamás 0 fijo — mismo cálculo
    -- que la 0065 ya usa para las transiciones de estado de la liquidación.
    v_tz_offset := (extract(epoch from
      (p_ahora at time zone 'America/Santiago') - (p_ahora at time zone 'UTC')) / 60)::int;

    insert into eventos (
      tipo_id, objeto_tabla, objeto_id, actor_id, event_time, tz_offset_min, payload, client_uuid
    ) values (
      (select evento_tipo.id from evento_tipo where codigo = 'liquidacion_linea.disputada'),
      'liquidacion_lineas', p_linea_id, p_autor_id, p_ahora, v_tz_offset,
      jsonb_build_object('motivo_id', p_motivo_id, 'liquidacion_id', v_liquidacion.id),
      p_client_uuid
    );

    return query select p_linea_id, false;
  end;
  $$;

comment on function disputar_linea(uuid, uuid, text, uuid, uuid, timestamptz) is
  'Disputa de línea (§3.E1.9, AC-FTAR-06): corre SIN `SECURITY DEFINER` para que la RLS del '
  'rol `cliente` (§9.3.3) confine la búsqueda a SU empresa. 0 filas si la línea no existe o es '
  'ajena; `repetida=true` en el replay del mismo `client_uuid`; `check_violation` (422) fuera '
  'de ventana, sin motivo de catálogo, sobre liquidación no cerrada o sobre línea ya disputada.';
