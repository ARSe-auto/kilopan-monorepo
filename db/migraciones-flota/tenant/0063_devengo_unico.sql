-- 0063 — Devengo único: las líneas de liquidación las crea UNA función, en la BD. [AC-FTAR-03]
--
-- Fuente: §7.5 (guardrails de dinero) · §4.8 (CLP entero, jamás float; la aritmética de dinero
-- vive en la base) · §3.E1.8 (tarifa aplicable = la vigencia con mayor `vigente_desde` ≤ el
-- instante del hecho) · §3.E1.9 (línea = evidencia; cero líneas manuales por construcción).
--
-- ─── LAS DOS TABLAS NACEN ACÁ PORQUE EL DEVENGO NO TIENE DÓNDE ESCRIBIR ──────────────
--
-- `liquidaciones` y `liquidacion_lineas` son del §4.5/§4.6 y ningún AC anterior las creó: sin
-- ellas esta función no tendría destino. Se crean con la forma MÍNIMA que el devengo necesita.
-- Lo que es de los ACs siguientes NO se adelanta y se nombra para que nadie lo dé por hecho:
-- el `UNIQUE(tenant, tipo, id)` de la evidencia y el bloqueo por supersede/excursión son
-- AC-FTAR-04; que solo la liquidación `abierta` acepte líneas y que `cerrada` congele totales
-- es AC-FTAR-05. El `estado` existe acá solo como columna con su catálogo — la máquina que la
-- gobierna todavía no está escrita.
--
-- ─── POR QUÉ EL CANDADO TIENE DOS MITADES, Y NINGUNA SOBRA ──────────────────────────
--
-- El §7.5 pide que las líneas SOLO las cree la función `SECURITY DEFINER`. Eso se sostiene con
-- dos guardarraíles distintos, por los mismos dos caminos que ya usa el append-only del POD
-- (§7.4, 0055):
--
--   (a) el TRIGGER de abajo, que rebota con 42501 todo INSERT que no venga de adentro de
--       `devengar_entrega()` — y detiene también al migrador y a un `psql` a mano, que es
--       justamente lo que un REVOKE no puede detener porque el dueño no se revoca a sí mismo;
--   (b) el REVOKE INSERT al rol de app, que `db/flota/rol-app.mjs` deriva de la PRESENCIA de
--       este trigger (misma técnica que el REVOKE UPDATE/DELETE de los hechos: cero listas de
--       tablas que mantener en dos lados).
--
-- La mitad (a) por sí sola sería una convención: la marca que la abre es un `set_config` local
-- y cualquiera puede escribirla. La mitad (b) por sí sola dejaría entrar al migrador. Juntas,
-- el rol con el que corre la aplicación no puede insertar una línea ni declarándose en curso
-- de devengo, y nadie puede hacerlo por accidente desde una consola.

create table liquidaciones (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  empresa_cliente_id uuid        not null,
  -- El período es semanal en el seed y en el camino dorado (§10), pero la regla de corte sigue
  -- abierta (Pregunta 1 de la spec): la tabla guarda el rango, no la regla que lo eligió.
  periodo_inicio     date        not null,
  periodo_fin        date        not null,
  estado             text        not null default 'abierta',
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, empresa_cliente_id, periodo_inicio, periodo_fin),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint liquidaciones_estado_catalogo check (estado in ('abierta', 'cerrada', 'pagada')),
  constraint liquidaciones_periodo_ordenado check (periodo_fin >= periodo_inicio)
);
create index liquidaciones_tenant_empresa_idx
  on liquidaciones (tenant_id, empresa_cliente_id, periodo_inicio);

comment on table liquidaciones is
  'PLANIFICACIÓN — la liquidación de una empresa cliente por período (§4.6, §3.E1.9). El '
  'estado es `abierta→cerrada→pagada`; la máquina que lo mueve es AC-FTAR-05.';

create table liquidacion_lineas (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  liquidacion_id     uuid        not null,
  -- Redundante contra `liquidaciones`, y a propósito: es la columna por la que el confinamiento
  -- del rol `cliente` (§9.3.3) se aplica a la línea sin un join, igual que en `items`.
  empresa_cliente_id uuid        not null,
  -- La evidencia de la que nace la línea (§3.E1.9). El tipo es el catálogo literal del maestro;
  -- la unicidad por evidencia es AC-FTAR-04.
  evidencia_tipo     text        not null,
  evidencia_id       uuid        not null,
  concepto           text        not null,
  -- La vigencia EXACTA que se aplicó. Sin ella, «recalculable» sería una promesa: una tarifa
  -- corregida después dejaría a la línea sin forma de explicar de dónde salió su monto.
  tarifa_id          uuid        not null,
  cantidad           integer     not null default 1,
  precio_base_clp    bigint      not null,
  modificadores_clp  bigint      not null default 0,
  monto_clp          bigint      not null,
  -- El flag de bloqueo del §4.9 nace en el esquema E1 «para no migrar después»; quién lo
  -- levanta (supersede, excursión) es AC-FTAR-04.
  bloqueada          boolean     not null default false,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, liquidacion_id) references liquidaciones (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  foreign key (tenant_id, tarifa_id) references tarifas (tenant_id, id),
  constraint liquidacion_lineas_evidencia_catalogo check (
    evidencia_tipo in ('entrega_pod', 'cierre_turno', 'devolucion', 'sesion_recarga')
  ),
  constraint liquidacion_lineas_concepto_catalogo check (
    concepto in ('por_entrega', 'por_bulto', 'por_bloque_horas', 'por_devolucion', 'por_intento_fallido')
  ),
  constraint liquidacion_lineas_cantidad_positiva check (cantidad > 0),
  constraint liquidacion_lineas_montos_no_negativos check (
    precio_base_clp >= 0 and modificadores_clp >= 0 and monto_clp >= 0
  )
);
create index liquidacion_lineas_tenant_liquidacion_idx
  on liquidacion_lineas (tenant_id, liquidacion_id);
create index liquidacion_lineas_tenant_evidencia_idx
  on liquidacion_lineas (tenant_id, evidencia_tipo, evidencia_id);
create index liquidacion_lineas_tenant_empresa_idx
  on liquidacion_lineas (tenant_id, empresa_cliente_id);
create index liquidacion_lineas_tenant_tarifa_idx
  on liquidacion_lineas (tenant_id, tarifa_id);

comment on table liquidacion_lineas is
  'PLANIFICACIÓN — cada línea nace de UNA evidencia y su monto lo calcula la BD (§3.E1.9, '
  '§4.8). Cero líneas manuales por construcción: el INSERT directo rebota con 42501 y solo '
  '`devengar_entrega()` puede crearlas.';

comment on column liquidacion_lineas.monto_clp is
  'CLP entero calculado en la BD con `round_clp()` (§0, §4.8): precio base de la vigencia '
  'aplicable + modificadores de zona y horario. Jamás se calcula fuera de la base.';

/**
 * Cero líneas manuales por construcción (§3.E1.9, §7.5).
 *
 * Rebota con `insufficient_privilege` (42501) —el mismo código con el que rebota editar un
 * hecho append-only— todo INSERT que no venga de adentro de `devengar_entrega()`, que es la
 * única que levanta la marca local `app.devengo_en_curso`. La marca es LOCAL a la transacción
 * (§7.2: SET LOCAL siempre): una función que muriera a mitad no dejaría la puerta abierta para
 * la transacción siguiente del pool.
 */
create or replace function solo_el_devengo_crea_lineas() returns trigger
  language plpgsql as $$
  begin
    if nullif(current_setting('app.devengo_en_curso', true), '') is distinct from 'si' then
      raise exception
        'liquidacion_lineas no acepta INSERT directo (§3.E1.9, §7.5): las líneas las crea '
        'devengar_entrega(), la única función del devengo'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end;
  $$;

create trigger liquidacion_lineas_solo_devengo
  before insert on liquidacion_lineas
  for each row execute function solo_el_devengo_crea_lineas();

create trigger liquidaciones_auditar
  after insert or update or delete on liquidaciones
  for each row execute function auditar();
create trigger liquidacion_lineas_auditar
  after insert or update or delete on liquidacion_lineas
  for each row execute function auditar();

-- El confinamiento del rol `cliente` a SU empresa (§7.2, §9.3.3): toda tabla del módulo que
-- lleva `empresa_cliente_id` lleva su política, igual que `tarifas` (0061).
select aplicar_rls_de_empresa('liquidaciones');
select aplicar_rls_de_empresa('liquidacion_lineas');

/**
 * La tarifa aplicable a un hecho: la vigencia con mayor `vigente_desde` ≤ el instante del
 * hecho (§3.E1.8).
 *
 * Es la semántica del append-only de `tarifas`: corregir un precio agrega una fila con
 * `vigente_desde` mayor, así que la evidencia ANTERIOR al cambio tiene que seguir devengando
 * el precio viejo — si el devengo tomara «la última fila», recalcular una liquidación de la
 * semana pasada la cambiaría sola, y el drill-down del §3.E1.9 dejaría de explicar el monto.
 * Devuelve NULL cuando no hay ninguna vigencia que alcance al hecho.
 */
create or replace function tarifa_vigente_al(
  p_empresa_cliente_id uuid, p_concepto text, p_instante timestamptz
) returns tarifas
  language sql stable as $$
  select t.* from tarifas t
   where t.empresa_cliente_id = p_empresa_cliente_id
     and t.concepto = p_concepto
     and t.vigente_desde <= p_instante
   order by t.vigente_desde desc
   limit 1
  $$;

comment on function tarifa_vigente_al(uuid, text, timestamptz) is
  'La vigencia con mayor `vigente_desde` ≤ el instante del hecho (§3.E1.8). NULL si ninguna '
  'alcanza: el devengo no inventa montos (Pregunta 8 de la spec 06).';

/**
 * Los modificadores de `por_entrega`, en la MISMA línea y jamás como concepto (§0, §3.E1.8).
 *
 * DEGRADA, JAMÁS REBOTA: una entrega cuyo destino no calza con ninguna zona —o que ni siquiera
 * tiene comuna cargada— devenga el precio BASE, sin error. Es lo contrario de lo que haría un
 * cálculo defensivo: rebotar ahí dejaría sin cobrar una entrega que sí ocurrió, por un dato de
 * planificación que nadie llenó. `coalesce` sobre el resultado del `max`, y no `strict`, porque
 * «ninguna zona calza» es el caso NORMAL, no el excepcional.
 *
 * El horario se evalúa sobre la hora LOCAL del hecho (§4.6, doble reloj): `event_time` es
 * timestamptz y el huso viaja aparte en `tz_offset_min`, así que una franja «18:00 a 22:00»
 * pactada con la empresa se mide contra el reloj de pared del chofer y no contra UTC. Una
 * franja que cruza la medianoche (22:00 a 06:00) se lee como dos tramos.
 */
create or replace function modificadores_de_entrega(
  p_empresa_cliente_id uuid, p_comuna text, p_instante timestamptz, p_tz_offset_min integer
) returns bigint
  language sql stable as $$
  select coalesce(
    (select max(z.monto_clp) from tarifa_zonas z
      where z.empresa_cliente_id = p_empresa_cliente_id
        and p_comuna is not null
        and p_comuna = any (z.comunas)), 0)
  + coalesce(
    (select max(h.monto_clp) from tarifa_recargo_horario h
      where h.empresa_cliente_id = p_empresa_cliente_id
        and (
          case when h.hora_inicio <= h.hora_fin then
            ((p_instante at time zone 'UTC') + make_interval(mins => p_tz_offset_min))::time
              between h.hora_inicio and h.hora_fin
          else
            ((p_instante at time zone 'UTC') + make_interval(mins => p_tz_offset_min))::time
              >= h.hora_inicio
            or ((p_instante at time zone 'UTC') + make_interval(mins => p_tz_offset_min))::time
              <= h.hora_fin
          end
        )), 0)
  $$;

comment on function modificadores_de_entrega(uuid, text, timestamptz, integer) is
  'Zona + recargo horario de `por_entrega` (§3.E1.8). Sin zona que calce o sin comuna '
  'resoluble devuelve 0: precio base, cero error (degradación, §4.2).';

/**
 * EL devengo (§7.5, §3.E1.9): la única función que crea líneas de liquidación.
 *
 * `SECURITY DEFINER` porque corre con los privilegios del dueño del esquema y no con los del
 * rol de app, que tiene el INSERT revocado — es la misma técnica de la ecuación de cierre
 * (§4.5). `search_path` fijado en la definición: sin eso, un `search_path` puesto por quien
 * llama elegiría qué `tarifas` lee una función que corre como dueño (§7.2).
 *
 * Devuelve el id de la línea, o NULL cuando NO corresponde crearla. Los tres casos de NULL son
 * decisiones, no omisiones:
 *   · la evidencia no está vigente (`cerrada AND supersede IS NULL`, §4.5) o no declaró una
 *     entrega efectuada — el devengo nace de la evidencia VIGENTE y de ninguna otra;
 *   · ya existe la línea de esa evidencia — el devengo se puede correr dos veces sobre el
 *     mismo período sin duplicar el cobro (la unicidad que lo vuelve estructural es AC-FTAR-04);
 *   · no hay tarifa vigente al instante del hecho — el maestro no cierra ese caso (Pregunta 8)
 *     y el devengo NO inventa montos.
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
    -- `por_entrega` se devenga sobre el encargo ENTREGADO (§3 de la spec 06). La no-entrega
    -- tiene su propio concepto (`por_intento_fallido`) y su propia regla, que no es esta.
    if v_pod.resultado not in ('exito', 'parcial') then
      return null;
    end if;

    select e.empresa_cliente_id, d.comuna into v_empresa, v_comuna
      from encargos e join destinos d on d.id = e.destino_id
     where e.id = v_pod.encargo_id;

    select id into v_linea from liquidacion_lineas
     where evidencia_tipo = 'entrega_pod' and evidencia_id = v_pod.id;
    if found then
      return v_linea;
    end if;

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
  'evidencia (§3.E1.8). Devuelve NULL cuando no corresponde crear línea.';
