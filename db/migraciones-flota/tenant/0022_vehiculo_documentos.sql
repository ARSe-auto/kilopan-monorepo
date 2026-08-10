-- 0022 — `vehiculo_documentos`: revisión técnica, permiso, SOAP. [AC-FVEH-03]
--
-- El §3.E1.3 los nombra por su nombre y el §4.5 les da la conducta: un documento vencido
-- REBOTA la planificación, pero SOLO si el feature está encendido.
--
-- ─── EL TIPO ES TEXTO Y NO UN ENUM, A PROPÓSITO ─────────────────────────────────────
--
-- El §4.5 no cierra el catálogo y la **pregunta 2** de la spec 02 lo pregunta: ¿lista cerrada
-- de plataforma, o filas por tenant? Un enum con tres valores respondería «lista cerrada» por
-- el dueño, y el día que una empresa necesite guardar el permiso municipal de una comuna
-- habría que migrar el esquema para algo que el maestro nunca prohibió. Texto con un CHECK de
-- no-vacío deja las dos respuestas posibles: si el dueño cierra la lista, se agrega el CHECK;
-- si la abre por tenant, nace su catálogo y esta columna pasa a ser una FK.
--
-- ─── `sha256` ES WRITE-ONCE (§4.6) ──────────────────────────────────────────────────
--
-- El hash viaja en la mutación ANTES del binario, y una vez escrito no se cambia: si se
-- pudiera, el documento que alguien revisó en marzo y el que está guardado hoy podrían ser
-- distintos sin que nada lo delate. Se puede pasar de NULL a un valor —el documento se carga
-- después, el alta es progresiva— pero no de un valor a otro. Reemplazar un documento es una
-- fila NUEVA, que además deja la anterior como historia.
--
-- ─── QUÉ SIGNIFICA «VENCIDO» ────────────────────────────────────────────────────────
--
-- `vence_el` es una FECHA, no un instante, y el día del vencimiento el documento TODAVÍA vale:
-- una revisión técnica que vence el 30 sirve el 30 entero. Por eso la comparación es
-- `vence_el < hoy` y no `<=`. Un día de más en el rebote es un camión detenido sin motivo, y
-- el operador aprendiendo que la app se equivoca.

create table vehiculo_documentos (
  id          uuid        not null default uuidv7(),
  tenant_id   uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  vehiculo_id uuid        not null,
  tipo        text        not null,
  vence_el    date        not null,
  sha256      text,
  creado_en   timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, vehiculo_id) references vehiculos (tenant_id, id),
  constraint vehiculo_documentos_tipo_no_vacio check (length(btrim(tipo)) > 0),
  -- 64 caracteres hexadecimales, ni uno más ni uno menos: un sha256 truncado se ve como un
  -- hash y no sirve para comparar nada.
  constraint vehiculo_documentos_sha256_bien_formado
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);

-- El índice que la FK compuesta necesita, y el que sirve a la consulta real: «los documentos
-- de este vehículo, del que vence primero al que vence último».
create index vehiculo_documentos_tenant_vehiculo_idx
  on vehiculo_documentos (tenant_id, vehiculo_id, vence_el);

comment on table vehiculo_documentos is
  'PLANIFICACIÓN — documentos con vencimiento del vehículo (§3.E1.3, §4.5). Con el feature '
  'encendido, uno vencido rebota la planificación 422 con 0 filas; apagado no rebota nada.';

comment on column vehiculo_documentos.vence_el is
  'El día del vencimiento el documento TODAVÍA vale: la comparación es `vence_el < hoy`. Un '
  'día de más en el rebote es un camión detenido sin motivo.';

/**
 * `sha256` write-once (§4.6). De NULL a un valor sí —el documento se carga después de dar de
 * alta el vencimiento, que es lo que hace posible el alta progresiva del §5.4—; de un valor a
 * otro, jamás.
 */
create or replace function sha256_write_once() returns trigger
  language plpgsql as $$
  begin
    if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
      raise exception
        'el sha256 de un documento no se reescribe (§4.6): reemplazar un documento es una fila '
        'nueva, y la anterior queda como historia'
        using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

comment on function sha256_write_once() is
  'Trigger BEFORE UPDATE que hace write-once al `sha256` de un documento (§4.6). De NULL a un '
  'valor sí; de un valor a otro, jamás.';

create trigger vehiculo_documentos_sha256_write_once
  before update on vehiculo_documentos
  for each row execute function sha256_write_once();

create trigger vehiculo_documentos_auditar
  after insert or update or delete on vehiculo_documentos
  for each row execute function auditar();

/**
 * ¿Este vehículo tiene algún documento vencido HOY?
 *
 * Vive en la BASE y no en el servidor porque la usan dos puertas de planificación distintas
 * —abrir turno y agendar un bloque— y va a usarla una tercera cuando llegue la asignación a
 * rutas del hito (d). Tres copias del mismo `where` son tres lugares donde el `<=` se cuela.
 *
 * El día es el de Chile (§0): con el huso del servidor, un documento que vence hoy se leería
 * como vencido desde las 21:00 de ayer.
 */
create or replace function tiene_documentos_vencidos(p_vehiculo uuid) returns boolean
  language sql stable as $$
    select exists (
      select 1 from vehiculo_documentos
       where vehiculo_id = p_vehiculo
         and vence_el < (now() at time zone 'America/Santiago')::date
    )
  $$;

comment on function tiene_documentos_vencidos(uuid) is
  'Si el vehículo tiene algún documento vencido hoy en Chile. La consultan todas las puertas '
  'de planificación: tres copias del mismo WHERE son tres lugares donde el `<=` se cuela.';

insert into evento_tipo (codigo, descripcion) values
  ('gobierno.documento_cargado',   'El dueño cargó un documento con vencimiento de un vehículo'),
  ('gobierno.documento_eliminado', 'El dueño sacó un documento de la ficha de un vehículo');
