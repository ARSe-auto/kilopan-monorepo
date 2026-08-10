-- 0016 — La tabla `vehiculos` (§4.5, §5.4, §3.E1.3). [AC-FVEH-01]
--
-- Primera tabla del módulo 02, el primer módulo OPERATIVO de la plataforma: de acá cuelga el
-- denominador de la EEVD (§2) y todo el corazón EV. La tabla nace en `tenant_template`, como
-- cada tabla de dominio (§4.1).
--
-- ─── EL ALTA TIENE DOS CAMPOS Y EL RESTO ES PROGRESIVO ───────────────────────────────
--
-- El §5.4 lo escribe así: «patente + tipo (chips) ⇒ ya operable; capacidades, foto, documentos
-- con vencimiento y batería EV progresivos». Por eso solo `patente` y `tipo` son NOT NULL, y
-- ninguna columna EV lleva default: un default sano inventado —una autonomía de folleto, un
-- SOH de 100— haría que el semáforo del §5.2-F3 calculara con un número que nadie midió, y el
-- Anexo A es explícito en que los 305 km CLTC no son los 185–245 reales. Un NULL dice «no lo
-- sabemos» y deja al tablero mostrar el estado vacío accionable que el AC-FVEH-12 pide; un
-- default dice una cifra falsa con cara de dato. (El seed de `autonomia_nominal_km` del EV48
-- es la pregunta 4 de la spec 02, abierta: acá no se responde.)
--
-- ─── `odometro` Y `soc` SON PROYECCIONES, NO CAMPOS ──────────────────────────────────
--
-- El §4.5 dice «odometro/soc SOLO mantenidos por trigger de chequeos». Escribir eso en un
-- comentario y dejar las columnas abiertas sería confiar en que nadie haga jamás un UPDATE
-- directo — y el día que alguien lo haga, la proyección deja de derivarse de `reading` y la
-- monotonicidad suave del §4.6 pasa a ser una promesa sin sujeto. Acá el «SOLO» se sostiene
-- con un trigger que rebota cualquier escritura de esas dos columnas que no venga del
-- proyector (`flota.proyectando`), que es lo que va a encender el trigger de `reading` de
-- AC-FVEH-05: hoy la puerta existe y no la abre nadie, y por eso el alta las deja en NULL.
--
-- El CHECK 0–100 del SOC vive ACÁ Y EN NINGÚN OTRO LADO (§0 fila SOC, §9.3.4): `reading` no
-- lleva rango a propósito, porque una captura fuera de rango entra con flag en vez de
-- rebotarle al chofer. El linter de migraciones vigila la otra mitad.

create table vehiculos (
  id                   uuid        not null default uuidv7(),
  tenant_id            uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  -- La identidad operativa del vehículo, normalizada por la app antes de llegar (sin guiones
  -- ni espacios, en mayúsculas): el UNIQUE por tenant no sirve de nada si «AB-1234» y
  -- «ab1234» pueden convivir. El CHECK guarda la forma, la app garantiza la normalización.
  patente              text        not null,
  tipo                 text        not null,
  capacidad_bultos     int,
  capacidad_kg         int,
  bateria_wh           int,
  autonomia_nominal_km int,
  wh_por_km_base       int,
  soh_pct              smallint,
  -- Los identificadores del vehículo en sistemas de terceros (§4.5). `jsonb` y no una tabla
  -- satélite: son pares clave/valor opacos que esta plataforma no interpreta jamás.
  external_ids         jsonb       not null default '{}'::jsonb,
  -- La desactivación del §5.4. El DELETE de HTTP se materializa acá (AC-FVEH-02): un vehículo
  -- con hechos asociados jamás se borra físicamente (§7.4).
  activo               boolean     not null default true,
  odometro             int,
  soc                  smallint,
  creado_en            timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, patente),
  constraint vehiculos_patente_normalizada
    check (patente ~ '^[A-Z0-9]{4,12}$'),
  constraint vehiculos_tipo_no_vacio
    check (length(btrim(tipo)) > 0),
  constraint vehiculos_soh_en_rango
    check (soh_pct is null or soh_pct between 0 and 100),
  -- El único CHECK de rango del SOC en toda la base (§0 fila SOC).
  constraint vehiculos_soc_en_rango
    check (soc is null or soc between 0 and 100),
  constraint vehiculos_odometro_no_negativo
    check (odometro is null or odometro >= 0),
  constraint vehiculos_capacidades_no_negativas
    check ((capacidad_bultos is null or capacidad_bultos >= 0)
       and (capacidad_kg is null or capacidad_kg >= 0)),
  constraint vehiculos_datos_ev_positivos
    check ((bateria_wh is null or bateria_wh > 0)
       and (autonomia_nominal_km is null or autonomia_nominal_km > 0)
       and (wh_por_km_base is null or wh_por_km_base > 0))
);

-- El listado que consume el panel del dueño y la asignación del operador: los activos primero
-- y por patente, que es como se busca un vehículo cuando se lo tiene delante.
create index vehiculos_tenant_activo_idx on vehiculos (tenant_id, activo, patente);

comment on table vehiculos is
  'PLANIFICACIÓN — el alta, la edición y la desactivación son del dueño, con red, y rebotan '
  '422 con 0 filas (§4.2, §5.4). Alta operable con patente + tipo; el resto es progresivo.';

comment on column vehiculos.odometro is
  'PROYECCIÓN del último odómetro declarado. La mantiene SOLO el trigger de lecturas (§4.5); '
  'un UPDATE directo rebota. La serie de verdad vive en `reading` (§4.6).';
comment on column vehiculos.soc is
  'PROYECCIÓN del último SOC declarado, con el ÚNICO CHECK 0–100 de la base (§0 fila SOC). '
  'La mantiene SOLO el trigger de lecturas, que clampa y marca flag (AC-FVEH-05).';

-- ─── El guardián de las proyecciones ─────────────────────────────────────────────────
--
-- `flota.proyectando` lo enciende el proyector dentro de su propia transacción
-- (`set_config('flota.proyectando', 'si', true)`), y ese es el único camino: una escritura
-- suelta de `odometro` o `soc` rebota con la misma clase de error que un CHECK.
--
-- No es una barrera de seguridad —quien puede escribir la tabla puede encender el GUC— y
-- decirlo importa: es una barrera contra el DESCUIDO, que es de lo que hay que protegerse
-- cuando una proyección tiene que derivarse de una serie append-only y no de lo que alguien
-- tipeó en un formulario.
create or replace function proyeccion_solo_por_trigger() returns trigger
  language plpgsql as $$
  begin
    if coalesce(current_setting('flota.proyectando', true), '') = 'si' then
      return new;
    end if;
    if tg_op = 'INSERT' then
      if new.odometro is not null or new.soc is not null then
        raise exception
          'odometro/soc son proyecciones: se llegan por `reading`, jamás en el alta (§4.5)'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if new.odometro is distinct from old.odometro or new.soc is distinct from old.soc then
      raise exception
        'odometro/soc son proyecciones mantenidas SOLO por el trigger de lecturas (§4.5): '
        'un UPDATE directo las separaría de la serie que las produce'
        using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

comment on function proyeccion_solo_por_trigger() is
  'Trigger BEFORE que rebota toda escritura de `vehiculos.odometro`/`soc` que no venga del '
  'proyector de lecturas (§4.5, §4.6).';

create trigger vehiculos_proyeccion_solo_por_trigger
  before insert or update on vehiculos
  for each row execute function proyeccion_solo_por_trigger();

-- El alta, la edición y la desactivación son actos del dueño: dejan rastro (§3.E1.14, §4.6).
create trigger vehiculos_auditar
  after insert or update or delete on vehiculos
  for each row execute function auditar();

-- El acto de gobierno del §5.4 «alta … de VEHÍCULOS», con su código en el catálogo cerrado.
-- Sin esta fila, `registrarEvento` no encuentra el tipo y el alta entera se deshace — que es
-- la conducta buscada: un vehículo dado de alta sin rastro es peor que un alta que falló.
insert into evento_tipo (codigo, descripcion) values
  ('gobierno.vehiculo_creado', 'El dueño dio de alta un vehículo con patente y tipo');
