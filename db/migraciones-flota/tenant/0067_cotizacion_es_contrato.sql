-- 0067 — Cotización = contrato: borrador simula, «Aceptar» se vuelve v1 sin re-digitación.
-- [AC-FTAR-11]
--
-- Fuente: §3.E1.8 (spec 06 §4 «Cotización = contrato»): rate card en estado BORRADOR más
-- volúmenes hipotéticos produce un total simulado en CLP entero con la MISMA lógica del
-- devengo (`round_clp()`, §0, §4.8 — que la fórmula sea LITERALMENTE `devengar_entrega()` es
-- decisión de implementación fuera del oráculo de este AC: acá no hay evidencia real que
-- devengar, solo un volumen hipotético). «Aceptar» convierte el MISMO borrador en la v1
-- vigente, cero re-digitación. El borrador y sus volúmenes NUNCA son evidencia: jamás generan
-- líneas de liquidación. Aceptar un borrador que dejaría más de
-- `TARIFAS.activos_max_por_empresa` conceptos activos rebota con 0 filas.
--
-- ─── POR QUÉ EL BORRADOR NO VIVE ADENTRO DE `tarifas` ────────────────────────────────
--
-- `tarifas` es append-only desde AC-FTAR-02: cualquier fila que exista ahí ya es una vigencia
-- real, y `tarifa_vigente_al()` (AC-FTAR-03, 0063) la toma para devengar sin preguntar si es
-- «solo un borrador». Meter el borrador en la misma tabla —aunque fuera con una columna
-- `estado`— arriesgaría tarificar una entrega real con un precio que nadie aceptó todavía, y
-- el §3.E1.8 es explícito: «el borrador jamás tarifica operación real». El borrador vive en
-- tablas propias, fuera del camino que lee el devengo.
--
-- ─── «EL MISMO BORRADOR», LITERAL: LA FILA CONSERVA SU `id` AL ACEPTARSE ─────────────
--
-- «Cero re-digitación» no es solo «no vuelvas a pedir los datos» — es que la fila que se
-- acepta y la vigencia que nace son LA MISMA identidad. `cotizacion_tarifas.id` es el `id` con
-- el que `aceptar_cotizacion()` inserta en `tarifas`: el test de este AC compara las filas
-- antes (en el borrador) y después (en `tarifas`) por ese mismo `id`, no por sus columnas.
--
-- ─── EL TOPE DE 4 CONCEPTOS NO SE DUPLICA: LO DA GRATIS EL TRIGGER DE AC-FTAR-01 ─────
--
-- `aceptar_cotizacion()` inserta cada línea del borrador con un INSERT normal sobre `tarifas`
-- —el rol de app conserva ese privilegio; solo `liquidacion_lineas` lo tiene revocado
-- (§7.5, AC-FTAR-03)— así que pasa por `tarifas_limite_conceptos` (0061) igual que cualquier
-- alta manual. Un borrador que dejaría 5 conceptos DISTINTOS activos rebota ahí, con el mismo
-- `errcode = check_violation` que el servidor ya traduce a 422 (§4.2) — y como el rebote ocurre
-- DENTRO de la única llamada a la función, la transacción que la invoca revierte todo lo que
-- alcanzó a insertar: 0 filas, no una aceptación parcial.

create table cotizaciones (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  empresa_cliente_id uuid        not null,
  -- Solo dos estados: el borrador nunca tarifica y la aceptación es la única transición que
  -- existe en E1 (§3.E1.8 no define una cotización rechazada o expirada).
  estado             text        not null default 'borrador',
  creado_en          timestamptz not null default now(),
  aceptada_en        timestamptz,
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint cotizaciones_estado_catalogo check (estado in ('borrador', 'aceptada')),
  constraint cotizaciones_aceptada_en_coherente check (
    (estado = 'aceptada') = (aceptada_en is not null)
  )
);
create index cotizaciones_tenant_empresa_idx on cotizaciones (tenant_id, empresa_cliente_id);

comment on table cotizaciones is
  'PLANIFICACIÓN — la cotización de una empresa cliente (§3.E1.8, spec 06 §4). `borrador` '
  'simula con volúmenes hipotéticos y jamás tarifica operación real; `aceptada` es terminal '
  '— sus líneas ya viven en `tarifas` con el MISMO id, sin re-digitación.';

create trigger cotizaciones_auditar
  after insert or update or delete on cotizaciones
  for each row execute function auditar();

select aplicar_rls_de_empresa('cotizaciones');

-- ─── Las líneas del borrador: el precio hipotético por concepto, antes de ser vigencia ────

create table cotizacion_tarifas (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  cotizacion_id      uuid        not null,
  -- Redundante contra `cotizaciones`, a propósito: es la columna por la que
  -- `aplicar_rls_de_empresa()` confina al rol `cliente` sin un join, igual que
  -- `liquidacion_lineas` (0063).
  empresa_cliente_id uuid        not null,
  concepto           text        not null,
  precio_clp         bigint      not null,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, cotizacion_id, concepto),
  foreign key (tenant_id, cotizacion_id) references cotizaciones (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint cotizacion_tarifas_concepto_catalogo check (
    concepto in ('por_entrega', 'por_bulto', 'por_bloque_horas', 'por_devolucion', 'por_intento_fallido')
  ),
  constraint cotizacion_tarifas_precio_no_negativo check (precio_clp >= 0)
);
create index cotizacion_tarifas_tenant_cotizacion_idx on cotizacion_tarifas (tenant_id, cotizacion_id);
create index cotizacion_tarifas_tenant_empresa_idx on cotizacion_tarifas (tenant_id, empresa_cliente_id);

comment on table cotizacion_tarifas is
  'PLANIFICACIÓN — precio hipotético por concepto de un borrador (§3.E1.8). Mismo catálogo '
  'cerrado de 5 que `tarifas`; su `id` es el que `aceptar_cotizacion()` reutiliza al convertir '
  'la línea en vigencia real, sin re-digitación.';

create trigger cotizacion_tarifas_auditar
  after insert or update or delete on cotizacion_tarifas
  for each row execute function auditar();

select aplicar_rls_de_empresa('cotizacion_tarifas');
-- Lleva precio_clp: la misma RESTRICTIVE FOR SELECT del §4.8 que ya protege `tarifas`
-- (AC-FTAR-09) — acá se aplica desde el día 1 en vez de sumarse a la deuda declarada en
-- `db/flota/pgtap/0032_dinero_invisible.sql`.
select aplicar_rls_de_dinero('cotizacion_tarifas');

-- ─── Los volúmenes hipotéticos: NUNCA evidencia, solo el insumo de la simulación ──────────

create table cotizacion_volumenes (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  cotizacion_id      uuid        not null,
  empresa_cliente_id uuid        not null,
  concepto           text        not null,
  cantidad           integer     not null,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, cotizacion_id, concepto),
  foreign key (tenant_id, cotizacion_id) references cotizaciones (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint cotizacion_volumenes_concepto_catalogo check (
    concepto in ('por_entrega', 'por_bulto', 'por_bloque_horas', 'por_devolucion', 'por_intento_fallido')
  ),
  constraint cotizacion_volumenes_cantidad_positiva check (cantidad > 0)
);
create index cotizacion_volumenes_tenant_cotizacion_idx on cotizacion_volumenes (tenant_id, cotizacion_id);
create index cotizacion_volumenes_tenant_empresa_idx on cotizacion_volumenes (tenant_id, empresa_cliente_id);

comment on table cotizacion_volumenes is
  'PLANIFICACIÓN — volumen hipotético por concepto para simular el total de un borrador '
  '(§3.E1.8). Jamás es evidencia: no existe camino que lo convierta en línea de liquidación.';

create trigger cotizacion_volumenes_auditar
  after insert or update or delete on cotizacion_volumenes
  for each row execute function auditar();

select aplicar_rls_de_empresa('cotizacion_volumenes');

-- ─── La simulación: MISMA lógica de redondeo que el devengo, cero evidencia tocada ────────

/**
 * Total simulado de un borrador (§3.E1.8): para cada concepto con precio Y volumen
 * hipotético cargados, `round_clp(precio_clp * cantidad)` — la MISMA función de redondeo que
 * usa `devengar_entrega()` (0063), sobre datos hipotéticos en vez de evidencia real. Un
 * concepto con precio pero sin volumen (o viceversa) no aporta al total: no hay negocio del
 * que inventar una cantidad.
 *
 * `STABLE`, no `SECURITY DEFINER`: lee `cotizacion_tarifas`/`cotizacion_volumenes` con los
 * privilegios de quien llama, así que el confinamiento del rol `cliente` (§9.3.3) aplica acá
 * igual que en cualquier SELECT crudo.
 */
create or replace function simular_cotizacion(p_cotizacion_id uuid) returns bigint
  language sql stable as $$
  select coalesce(sum(round_clp((ct.precio_clp * cv.cantidad)::numeric)), 0)
    from cotizacion_tarifas ct
    join cotizacion_volumenes cv
      on cv.tenant_id = ct.tenant_id
     and cv.cotizacion_id = ct.cotizacion_id
     and cv.concepto = ct.concepto
   where ct.cotizacion_id = p_cotizacion_id
  $$;

comment on function simular_cotizacion(uuid) is
  'Total CLP simulado de un borrador (§3.E1.8): round_clp(precio × volumen hipotético) por '
  'concepto. Nunca toca liquidacion_lineas — el borrador no es evidencia.';

/**
 * «Aceptar» (§3.E1.8): el MISMO borrador se convierte en la v1 vigente, cero re-digitación.
 *
 * Cada línea de `cotizacion_tarifas` nace en `tarifas` con SU MISMO `id` — la identidad es la
 * prueba de que no hubo re-digitación, no una comparación de columnas. El INSERT es el de
 * siempre (sin `SECURITY DEFINER`: el rol de app tiene privilegio directo sobre `tarifas`,
 * §7.5 solo revoca el de `liquidacion_lineas`), así que atraviesa los mismos guardarraíles que
 * cualquier alta manual: `tarifas_limite_conceptos` (0061, tope de
 * `TARIFAS.activos_max_por_empresa`) y `tarifas_vigencia_no_solapada` (0062). Si el borrador
 * dejaría más de 4 conceptos DISTINTOS activos, el trigger rebota a mitad de la función y
 * PostgreSQL revierte todo lo insertado en esta llamada — 0 filas, no una aceptación parcial.
 *
 * `vigente_desde` usa `clock_timestamp()` por el mismo motivo que 0062: dentro de una única
 * transacción, `now()` congelaría todas las líneas del borrador en el mismo instante y la
 * segunda entraría «solapada» consigo misma si el borrador corrige un concepto ya vigente.
 */
create or replace function aceptar_cotizacion(p_cotizacion_id uuid) returns void
  language plpgsql as $$
  declare
    v_cotizacion cotizaciones;
    v_linea      cotizacion_tarifas;
  begin
    select * into v_cotizacion from cotizaciones where id = p_cotizacion_id;
    if not found then
      raise exception 'cotización % no existe o no es visible (§3.E1.8)', p_cotizacion_id
        using errcode = 'check_violation';
    end if;
    if v_cotizacion.estado <> 'borrador' then
      raise exception
        'la cotización % ya no es un borrador (estado %): aceptar es terminal', p_cotizacion_id,
        v_cotizacion.estado
        using errcode = 'check_violation';
    end if;

    for v_linea in
      select * from cotizacion_tarifas where cotizacion_id = p_cotizacion_id order by creado_en
    loop
      insert into tarifas (id, empresa_cliente_id, concepto, precio_clp, vigente_desde)
      values (v_linea.id, v_linea.empresa_cliente_id, v_linea.concepto, v_linea.precio_clp, clock_timestamp());
    end loop;

    update cotizaciones set estado = 'aceptada', aceptada_en = clock_timestamp()
     where id = p_cotizacion_id;
  end;
  $$;

comment on function aceptar_cotizacion(uuid) is
  'Convierte el MISMO borrador en la v1 vigente (§3.E1.8): cada línea nace en `tarifas` con '
  'su mismo id, cero re-digitación. >4 conceptos activos ⇒ check_violation y 0 filas (lo da '
  'gratis tarifas_limite_conceptos, 0061). No toca liquidacion_lineas jamás.';
