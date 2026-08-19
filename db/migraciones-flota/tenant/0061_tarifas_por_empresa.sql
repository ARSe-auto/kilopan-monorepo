-- 0061 — Esquema de tarifas por empresa cliente: catálogo cerrado + modificadores. [AC-FTAR-01]
--
-- Primera migración del módulo 06 (hito f). El §3.E1.8 fija un catálogo CERRADO de 5 conceptos
-- de cobro, un tope de conceptos ACTIVOS por empresa cliente (`TARIFAS.activos_max_por_empresa`
-- en el canónico), y dos modificadores —zonas por comuna y recargo horario— que jamás son
-- conceptos del catálogo (§0, §7.5 anti-ancla: prohibido todo recargo por combustible/energía
-- indexado).
--
-- ─── EL CATÁLOGO ES UN CHECK, NO UN ENUM ────────────────────────────────────────────
--
-- Un `encargo_estado` (0036) creció con `ALTER TYPE … ADD VALUE` porque su lista estaba
-- deliberadamente abierta a que el dueño respondiera. Acá es al revés: el §0 fija los CINCO
-- conceptos, literales, y el §3.E1.8 dice «catálogo cerrado» con esas palabras. Un CHECK con la
-- lista adentro es más barato de leer que un enum para este caso, y el test de catálogo de este
-- AC lo ejerce insertando cada valor prohibido uno por uno.
--
-- ─── «4 ACTIVOS» SE CUENTA POR CONCEPTO DISTINTO, NO POR FILA ───────────────────────
--
-- La vigencia append-only (AC-FTAR-02) va a dejar MÁS de una fila por concepto — cada corrección
-- de precio es una fila nueva con `vigente_desde` mayor. Si el tope contara filas, la primera
-- corrección de precio de un concepto YA activo tropezaría con su propio tope. El tope cuenta
-- CONCEPTOS DISTINTOS: un concepto que la empresa ya tiene no gasta cupo nuevo al corregirse.
--
-- ─── LA FORMA DEL MODIFICADOR QUEDA ABIERTA (Pregunta 9) ────────────────────────────
--
-- El maestro no fija si zona y recargo horario son monto fijo CLP o porcentaje, ni si el tope de
-- 5 zonas es por empresa o por tenant. Esta migración asume monto fijo CLP (mismo tipo que el
-- resto del dinero del módulo, §0) y tope POR EMPRESA CLIENTE — el mismo supuesto operativo que
-- ya declaran los criterios de aceptación de la spec 06 para «zonas máx 5». El devengo que
-- APLICA el modificador (AC-FTAR-03) es quien de verdad resuelve la Pregunta 9; acá solo se
-- guarda el dato sin inventar la fórmula.

create table tarifas (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  empresa_cliente_id uuid        not null,
  -- El catálogo cerrado del §0 y del §3.E1.8, literal. Un concepto fuera de esta lista —incluidos
  -- «zona» y «horario», que son modificadores y jamás conceptos— rebota acá, en la BD.
  concepto           text        not null,
  precio_clp         bigint      not null,
  -- Vigencia append-only (§3.E1.8): esta migración solo declara la columna. El RAISE ante UPDATE
  -- y el rechazo de vigencias solapadas son AC-FTAR-02 (centinela 5).
  vigente_desde      timestamptz not null default now(),
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint tarifas_concepto_catalogo_cerrado check (
    concepto in ('por_entrega', 'por_bulto', 'por_bloque_horas', 'por_devolucion', 'por_intento_fallido')
  ),
  -- CLP entero, jamás negativo: un precio negativo no es un descuento, es un dato cargado mal
  -- (el descuento, si el dueño lo pide algún día, es otra columna con otro nombre).
  constraint tarifas_precio_no_negativo check (precio_clp >= 0)
);
create index tarifas_tenant_empresa_idx on tarifas (tenant_id, empresa_cliente_id, concepto);

comment on table tarifas is
  'PLANIFICACIÓN — la rate card por empresa cliente (§3.E1.8, §4.5). Concepto contra catálogo '
  'cerrado de 5; tope de conceptos DISTINTOS activos por empresa en '
  'TARIFAS.activos_max_por_empresa; el precio es CLP entero.';

comment on column tarifas.concepto is
  'Catálogo CERRADO de 5 (§0): por_entrega, por_bulto, por_bloque_horas, por_devolucion, '
  'por_intento_fallido. Zona y horario NO son conceptos — son modificadores (tarifa_zonas, '
  'tarifa_recargo_horario) y jamás pueden aparecer acá (§7.5 anti-ancla).';

/**
 * Máx 4 conceptos DISTINTOS activos por empresa cliente (§0, §3.E1.8).
 *
 * Cuenta conceptos, no filas: un concepto que la empresa YA tiene no gasta cupo al corregirse
 * (AC-FTAR-02 agregará filas nuevas del mismo concepto para las correcciones de precio). Solo el
 * quinto concepto DISTINTO rebota, con el mismo `errcode` que usa el resto del módulo para que
 * el servidor lo traduzca a 422 con 0 filas (§4.2).
 */
create or replace function tarifas_maximo_4_conceptos_activos() returns trigger
  language plpgsql as $$
  begin
    if exists (
      select 1 from tarifas
       where tenant_id = new.tenant_id
         and empresa_cliente_id = new.empresa_cliente_id
         and concepto = new.concepto
    ) then
      return new;
    end if;
    if (
      select count(distinct concepto) from tarifas
       where tenant_id = new.tenant_id
         and empresa_cliente_id = new.empresa_cliente_id
    ) >= 4 then
      raise exception
        'la empresa % ya llegó al tope de conceptos de tarifa distintos que permite '
        'TARIFAS.activos_max_por_empresa (§0)', new.empresa_cliente_id
        using errcode = 'check_violation';
    end if;
    return new;
  end;
  $$;

create trigger tarifas_limite_conceptos
  before insert on tarifas
  for each row execute function tarifas_maximo_4_conceptos_activos();

create trigger tarifas_auditar
  after insert or update or delete on tarifas
  for each row execute function auditar();

-- El rol `cliente` confinado a SU empresa (§7.2, §9.3.3, AC-FRUT-12): reutiliza la MISMA
-- función que ya confina `encargos`/`items`/`usuarios` (0040) — el centinela de esa suite
-- («toda tabla del módulo con empresa_cliente_id lleva su política») se pondría rojo si esta
-- migración dejara la columna sin confinar.
select aplicar_rls_de_empresa('tarifas');

-- ─── Zonas: modificador de `por_entrega` por comunas, jamás un concepto (§0, §3.E1.8) ────

create table tarifa_zonas (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  empresa_cliente_id uuid        not null,
  nombre             text        not null,
  -- Las comunas que definen la zona (§3.E1.8: «zonas … definidas por comunas»). Una zona sin
  -- comunas no delimita nada, y una entrega que no calza con ninguna cae a precio base sin
  -- error (AC-FTAR-03) — pero eso exige que TODA zona traiga al menos una.
  comunas            text[]      not null,
  monto_clp          bigint      not null default 0,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, empresa_cliente_id, nombre),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint tarifa_zonas_comunas_no_vacia check (array_length(comunas, 1) > 0),
  constraint tarifa_zonas_monto_no_negativo check (monto_clp >= 0)
);
create index tarifa_zonas_tenant_empresa_idx on tarifa_zonas (tenant_id, empresa_cliente_id);

comment on table tarifa_zonas is
  'PLANIFICACIÓN — zonas por comuna, modificador de `por_entrega` (§0, §3.E1.8). Jamás un '
  'concepto del catálogo. Máximo 5 por empresa cliente (supuesto operativo, Pregunta 9).';

/** El tope de 5 zonas del §0, evaluado POR EMPRESA CLIENTE (supuesto operativo, Pregunta 9). */
create or replace function tarifa_zonas_maximo_5_por_empresa() returns trigger
  language plpgsql as $$
  begin
    if (
      select count(*) from tarifa_zonas
       where tenant_id = new.tenant_id
         and empresa_cliente_id = new.empresa_cliente_id
    ) >= 5 then
      raise exception
        'la empresa % ya tiene 5 zonas: el §0 fija máximo 5', new.empresa_cliente_id
        using errcode = 'check_violation';
    end if;
    return new;
  end;
  $$;

create trigger tarifa_zonas_limite
  before insert on tarifa_zonas
  for each row execute function tarifa_zonas_maximo_5_por_empresa();

create trigger tarifa_zonas_auditar
  after insert or update or delete on tarifa_zonas
  for each row execute function auditar();

select aplicar_rls_de_empresa('tarifa_zonas');

-- ─── Recargo horario: el otro modificador de `por_entrega`, jamás un concepto (§0) ───────
--
-- Sin tope de cantidad en el maestro (el §0 solo fija el tope de ZONAS en 5): una empresa puede
-- tener varias franjas horarias con recargo distinto, y ninguna pregunta del dueño lo acota.

create table tarifa_recargo_horario (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  empresa_cliente_id uuid        not null,
  hora_inicio        time        not null,
  hora_fin           time        not null,
  monto_clp          bigint      not null default 0,
  creado_en          timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint tarifa_recargo_horario_rango_no_vacio check (hora_inicio <> hora_fin),
  constraint tarifa_recargo_horario_monto_no_negativo check (monto_clp >= 0)
);
create index tarifa_recargo_horario_tenant_empresa_idx on tarifa_recargo_horario (tenant_id, empresa_cliente_id);

comment on table tarifa_recargo_horario is
  'PLANIFICACIÓN — recargo horario, modificador de `por_entrega` (§0, §3.E1.8). Jamás un '
  'concepto del catálogo, y jamás indexado a combustible o energía (§7.5 anti-ancla).';

create trigger tarifa_recargo_horario_auditar
  after insert or update or delete on tarifa_recargo_horario
  for each row execute function auditar();

select aplicar_rls_de_empresa('tarifa_recargo_horario');
