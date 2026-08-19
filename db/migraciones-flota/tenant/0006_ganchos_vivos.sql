-- 0006 — Ganchos de extensión VIVOS de E1 (§4.6, §4.9). [AC-FTEN-14]
--
-- El mecanismo del §4.9 es uno solo y hay que decirlo antes de leer el DDL: **un vertical
-- nuevo es un INSERT de filas, jamás una migración**. NI tablas satélite por vertical NI jsonb
-- libre: registro de atributos TIPADO (`attribute_definition` versionada + `attrs jsonb`
-- validado por trigger contra la definición vigente), y las series y todo lo agregable a
-- tablas GENÉRICAS —`reading` acá, `eventos` en la 0002, `energy_entry` en el hito c—, jamás
-- a jsonb.
--
-- Este módulo es el ÚNICO creador de estas tablas (§4.9 las pone en la misma fila de ganchos
-- vivos, y toda tabla nace en `tenant_template`). Los módulos 02 y 03 las CONSUMEN: completan
-- las FK que hoy no pueden existir porque `paradas`, `vehiculos` y `turnos` son de sus hitos.
--
-- CERO SEEDS. Ni de frío, ni de `pin_destinatario` (§5.2 F4), ni de tipos de carga: las tablas
-- nacen vacías y el primer vertical las llena con INSERTs.

-- --- Catálogos de la extensión ------------------------------------------------------------

-- La raíz de extensión del §4.9: de qué tipo es lo que se transporta. El flujo del operario se
-- ARMA POR DATOS a partir de acá — cero condicionales por vertical en la UI.
create table cargo_type (
  id          uuid not null default uuidv7(),
  tenant_id   uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo      text not null,
  nombre      text not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo)
);
create index cargo_type_tenant_codigo_idx on cargo_type (tenant_id, codigo);
comment on table cargo_type is
  'PLANIFICACIÓN — raíz de extensión por vertical (§4.9). Un vertical nuevo son filas acá, '
  'jamás una migración.';

-- Qué se mide. `reading` es UNA tabla para odómetro, SOC, temperatura y humedad (§4.6), y lo
-- que distingue una lectura de otra es esta FK — no una columna por magnitud.
create table magnitud (
  id        uuid not null default uuidv7(),
  tenant_id uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo    text not null,
  unidad    text not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo)
);
create index magnitud_tenant_codigo_idx on magnitud (tenant_id, codigo);
comment on table magnitud is
  'PLANIFICACIÓN — qué se mide y en qué unidad. `reading` es UNA tabla para todas las '
  'magnitudes: lo que las distingue es esta FK, no una columna por cada una (§4.6).';

-- --- Registro de atributos tipado (el mecanismo del §4.9) ----------------------------------
create type attribute_tipo as enum ('texto', 'entero', 'decimal', 'booleano', 'fecha', 'opcion');

-- VERSIONADA: una definición no se edita, se supersede. Si se editara, los `attrs` ya escritos
-- pasarían a estar «mal» contra una definición que nadie aceptó cuando los escribió — y una
-- captura del terreno no se puede volver inválida retroactivamente (§4.2).
create table attribute_definition (
  id             uuid           not null default uuidv7(),
  tenant_id      uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  entidad        text           not null,
  clave          text           not null,
  version        int            not null default 1,
  tipo           attribute_tipo not null,
  obligatorio    boolean        not null default false,
  opciones       text[],
  vigente_desde  timestamptz    not null default now(),
  vigente_hasta  timestamptz,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, entidad, clave, version),
  constraint attribute_definition_opciones_solo_en_opcion
    check ((tipo = 'opcion') = (opciones is not null and cardinality(opciones) > 0)),
  constraint attribute_definition_vigencia_valida
    check (vigente_hasta is null or vigente_hasta > vigente_desde)
);
create index attribute_definition_tenant_entidad_idx
  on attribute_definition (tenant_id, entidad, clave, version desc);
comment on table attribute_definition is
  'PLANIFICACIÓN — registro de atributos TIPADO y versionado (§4.9). Ni tablas satélite por '
  'vertical ni jsonb libre: un atributo nuevo es una fila, y una definición no se edita.';

/**
 * La validación de `attrs` contra la definición VIGENTE. Se engancha a cualquier tabla con
 * `attrs jsonb` con una línea, igual que la RLS de dinero de AC-FTEN-21:
 *
 *   create trigger x_attrs before insert or update on x
 *     for each row execute function validar_attrs('encargos');
 *
 * Vigente = `vigente_desde <= now()` y (`vigente_hasta` nulo o futuro), quedándose con la
 * versión MÁS ALTA de cada clave. Las claves que no están definidas se rechazan: si pasaran,
 * `attrs` sería el jsonb libre que el §4.9 prohíbe con todas las letras.
 */
create or replace function validar_attrs() returns trigger
  language plpgsql as $$
  declare
    v_entidad text := tg_argv[0];
    v_attrs   jsonb := coalesce(new.attrs, '{}'::jsonb);
    v_def     record;
    v_clave   text;
    v_valor   jsonb;
  begin
    -- 1. Toda clave presente tiene que estar definida y ser del tipo declarado.
    for v_clave, v_valor in select * from jsonb_each(v_attrs) loop
      select distinct on (clave) * into v_def
        from attribute_definition
       where entidad = v_entidad and clave = v_clave
         and vigente_desde <= now() and (vigente_hasta is null or vigente_hasta > now())
       order by clave, version desc;

      if not found then
        raise exception
          'el atributo «%» no está definido para % en la versión vigente: attrs no es jsonb '
          'libre (§4.9)', v_clave, v_entidad
          using errcode = 'check_violation';
      end if;

      if not (
        case v_def.tipo
          when 'texto'    then jsonb_typeof(v_valor) = 'string'
          when 'entero'   then jsonb_typeof(v_valor) = 'number' and (v_valor::numeric) = trunc(v_valor::numeric)
          when 'decimal'  then jsonb_typeof(v_valor) = 'number'
          when 'booleano' then jsonb_typeof(v_valor) = 'boolean'
          when 'fecha'    then jsonb_typeof(v_valor) = 'string'
          when 'opcion'   then jsonb_typeof(v_valor) = 'string'
                               and (v_valor #>> '{}') = any (v_def.opciones)
        end
      ) then
        raise exception 'el atributo «%» de % no cumple su definición vigente (tipo %)',
          v_clave, v_entidad, v_def.tipo
          using errcode = 'check_violation';
      end if;
    end loop;

    -- 2. Y todo atributo OBLIGATORIO vigente tiene que estar. Sin esta mitad, un vertical
    --    podría exigir algo y la fila entraría igual sin ello.
    for v_def in
      select distinct on (clave) * from attribute_definition
       where entidad = v_entidad and obligatorio
         and vigente_desde <= now() and (vigente_hasta is null or vigente_hasta > now())
       order by clave, version desc
    loop
      if not v_attrs ? v_def.clave then
        raise exception 'falta el atributo obligatorio «%» de % (§4.9)', v_def.clave, v_entidad
          using errcode = 'check_violation';
      end if;
    end loop;

    return new;
  end
  $$;

comment on function validar_attrs() is
  'Trigger que valida `attrs` contra la definición VIGENTE de su entidad (§4.9). Se engancha '
  'con `execute function validar_attrs(''<entidad>'')`.';

-- --- reading: UNA tabla para todas las series (§4.6) ---------------------------------------
create type lectura_fuente as enum (
  'declarada', 'archivo_logger', 'api_fabricante', 'sonda_vehiculo', 'obd', 'ocpp'
);

-- `valor_int` NO lleva CHECK de rango, y es una decisión, no un olvido (§0 fila SOC, §9.3.4):
-- una captura fuera de rango ENTRA con flag y se revisa después; el CHECK 0–100 vive SOLO en
-- la proyección `vehiculos.soc`, con el trigger que clampa del hito c. Un rango acá haría que
-- una sonda descalibrada rebotara la captura del chofer, que es justo lo que el §4.2 prohíbe.
-- El linter de migraciones lo vigila: agregar ese CHECK pone el gate rojo.
create table reading (
  id             uuid           not null default uuidv7(),
  tenant_id      uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  magnitud_id    uuid           not null,
  valor_int      int            not null,
  fuente         lectura_fuente not null,
  contexto       text,
  instrumento_id uuid,
  turno_id       uuid,
  parada_id      uuid,
  sensor         text,
  -- Doble reloj (§4.6): cuándo lo midió el dispositivo, con su huso, y cuándo lo supo el
  -- servidor. Sin los dos, una lectura offline de ayer se lee como de hoy.
  ts_dispositivo timestamptz    not null,
  tz_offset_min  int            not null,
  record_time    timestamptz    not null default now(),
  client_uuid    uuid,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  -- Idempotencia DOBLE (§4.6): el `client_uuid` cubre el replay del outbox, y la tripleta
  -- cubre el archivo de un logger que se importa dos veces — ahí no hay client_uuid ninguno.
  unique (tenant_id, instrumento_id, sensor, ts_dispositivo),
  foreign key (tenant_id, magnitud_id) references magnitud (tenant_id, id)
);
create index reading_tenant_magnitud_idx on reading (tenant_id, magnitud_id, ts_dispositivo desc);
comment on table reading is
  'CAPTURA — lecturas de odómetro, SOC, temperatura y humedad en UNA sola tabla (§4.6). '
  '`valor_int` sin CHECK de rango a propósito: fuera de rango entra con flag (§0 fila SOC).';

create trigger reading_append_only
  before update or delete on reading
  for each row execute function rechazar_mutacion_de_hecho();
create trigger reading_append_only_truncate
  before truncate on reading
  for each statement execute function rechazar_mutacion_de_hecho();

-- --- Instrumentos y certificaciones --------------------------------------------------------
create table instrument (
  id             uuid not null default uuidv7(),
  tenant_id      uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo         text not null,
  descripcion    text not null,
  calibrado_hasta date,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo)
);
create index instrument_tenant_codigo_idx on instrument (tenant_id, codigo);
comment on table instrument is
  'PLANIFICACIÓN — instrumentos de medición y su calibración. Se dan de alta con red y '
  'rebotan (§4.9).';

-- La FK a `vehiculos` la completa el hito c: la tabla existe acá porque §4.9 la pone entre los
-- ganchos vivos y toda tabla nace en la plantilla.
create table vehicle_certification (
  id            uuid not null default uuidv7(),
  tenant_id     uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  vehiculo_id   uuid not null,
  tipo          text not null,
  numero        text,
  emitida_el    date not null,
  vence_el      date not null,
  primary key (id),
  unique (tenant_id, id),
  constraint vehicle_certification_vigencia_valida check (vence_el > emitida_el)
);
create index vehicle_certification_tenant_vehiculo_idx
  on vehicle_certification (tenant_id, vehiculo_id, vence_el);
comment on table vehicle_certification is
  'PLANIFICACIÓN — certificaciones del vehículo con su vencimiento. El rebote de '
  'planificación por certificación vencida se activa solo con feature ON (§4.9, §9.3.5).';

-- --- Requisitos de evidencia por parada ----------------------------------------------------
-- El flujo del operario se ARMA POR DATOS desde acá: cero condicionales por vertical en la UI
-- (§4.6). La FK a `paradas` la completa el hito d. Ningún seed E1 siembra `pin_destinatario`.
create table stop_requirement (
  id             uuid           not null default uuidv7(),
  tenant_id      uuid           not null default tenant_actual() check (tenant_id = tenant_actual()),
  parada_id      uuid           not null,
  tipo_evidencia evidencia_tipo not null,
  obligatorio    boolean        not null default true,
  orden          int            not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, parada_id, orden)
);
create index stop_requirement_tenant_parada_idx on stop_requirement (tenant_id, parada_id, orden);
comment on table stop_requirement is
  'PLANIFICACIÓN — qué evidencia pide cada parada y en qué orden. El flujo del operario se '
  'arma por DATOS: cero condicionales por vertical en la UI (§4.6).';

-- --- Trazabilidad: lote y documento de referencia ------------------------------------------
-- CAPTURA las dos, por respuesta del dueño del 08-ago-2026 a las Preguntas 11 y 13.
create table lot (
  id          uuid not null default uuidv7(),
  tenant_id   uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo      text not null,
  tlc         text,
  vencimiento date,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo)
);
create index lot_tenant_codigo_idx on lot (tenant_id, codigo);
comment on table lot is
  'CAPTURA — número de lote leído de la caja física, en terreno y posiblemente sin señal. Con '
  'PLANIFICACIÓN ese registro rebotaría 422 y se perdería (§4.2; respuesta del dueño 08-ago).';

-- LA APP JAMÁS EMITE DTE (art. 97 N°4 CT, §7.3). Acá SOLO se REFERENCIAN documentos que emitió
-- un tercero autorizado por el SII: no hay XML, no hay TED, no hay folio propio. El registro
-- manual del folio es camino paralelo permanente.
create type dte_tipo as enum ('33', '39', '52', '61');

create table reference_document (
  id        uuid     not null default uuidv7(),
  tenant_id uuid     not null default tenant_actual() check (tenant_id = tenant_actual()),
  tipo      dte_tipo not null,
  folio     text     not null,
  emisor    text     not null,
  fecha     date,
  primary key (id),
  unique (tenant_id, id),
  unique (tipo, folio, emisor)
);
create index reference_document_tenant_tipo_idx on reference_document (tenant_id, tipo, folio);
comment on table reference_document is
  'CAPTURA — referencia a un DTE emitido por un tercero autorizado por el SII. La app JAMÁS '
  'emite ni genera nada con apariencia de DTE (§7.3, art. 97 N°4 CT).';
