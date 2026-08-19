-- 0042 — El DTE gate: sin documento asociado, no queda a bordo. [AC-FRUT-08]
--
-- El art. 55 del DL 825 exige que la mercadería en tránsito vaya amparada por su documento. El
-- §7.3 lo convierte en la regla operativa: un ítem sin `reference_document` asociado no sube al
-- camión, y la única salida es BAJARLO del manifiesto — nunca un override silencioso.
--
-- ─── LA APP JAMÁS EMITE, Y ESO ES LO QUE PROTEGE ESTE DISEÑO ──────────────────────
--
-- `reference_document` (módulo 00) REFERENCIA un DTE que emitió un tercero autorizado por el SII.
-- Acá se crean filas desde el andén —escaneando el TED o tecleando el folio— y nada más. Emitir
-- un documento con apariencia de DTE sin ser emisor autorizado es el art. 97 N°4 del Código
-- Tributario, y no es una multa: es un delito. Por eso la app no tiene una sola ruta que genere
-- XML, TED ni folios, y un grep-gate lo vigila.
--
-- El `UNIQUE(tipo, folio, emisor)` ya está en la 0006 y es el que hace que dos capturas del mismo
-- documento LIGUEN a la misma fila en vez de duplicarla (§4.2, semántica «creando/ligando»).
--
-- ─── POR QUÉ LA ASOCIACIÓN VIVE EN `manifiesto_items` Y NO EN UNA TABLA APARTE ────
--
-- El documento ampara ESA carga de ESA empresa en ESE traspaso. Una tabla de asociación N a N
-- permitiría el mismo documento sobre ítems de dos manifiestos distintos, que es justo lo que el
-- art. 55 no admite. La columna lo dice sin ambigüedad y hace que la pregunta «¿este bulto tiene
-- documento?» sea mirar la fila, no recorrer una relación.
--
-- ─── «BAJAR DEL MANIFIESTO» NO ES UN CAMPO OPCIONAL ──────────────────────────────
--
-- Es una vía EXPLÍCITA con su motivo, su evento y su auditoría (§7.3). Sin ella, el operario con
-- un camión que tiene que salir a las cinco encuentra la forma —confirma con un folio inventado—
-- y ahí sí que la app produjo un dato falso. Con ella, la mercadería se baja, queda escrito quién
-- lo hizo y por qué, y el camión sale legal.

-- ─── POR QUÉ ESTO ES UNA TABLA Y NO DOS COLUMNAS EN `manifiesto_items` ────────────
--
-- Fue el primer intento y lo rebotó el árbol en un minuto: `manifiesto_items` es append-only
-- (§7.4), y asociar el documento —que ocurre DESPUÉS de contar, en el paso 3 del §5.2 F2—
-- exigiría un UPDATE. La respuesta correcta no era abrirle una excepción al append-only: era
-- entender que amparar y bajar son ACTOS con su propio autor y su propio momento, no atributos
-- de la fila del conteo.
--
-- Así, además, el §7.3 sale gratis: «la bajada emite evento y auditoría» es cierto porque la
-- bajada ES una fila, con quién la hizo y cuándo.

create table manifiesto_item_documento (
  id                    uuid        not null default uuidv7(),
  tenant_id             uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  manifiesto_item_id    uuid        not null,
  -- O se ampara con un documento, o se baja con su motivo. Nunca las dos, nunca ninguna.
  reference_document_id uuid,
  bajado_motivo         text,
  -- Quién hizo el acto: es lo que convierte «bajar del manifiesto» en una vía explícita y no en
  -- un override silencioso (§7.3).
  actor_id              uuid,
  client_uuid           uuid,
  creado_en             timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  -- UN acto por ítem: dos amparos del mismo bulto serían dos verdades sobre la misma carga.
  unique (tenant_id, manifiesto_item_id),
  foreign key (tenant_id, manifiesto_item_id) references manifiesto_items (tenant_id, id),
  foreign key (tenant_id, reference_document_id) references reference_document (tenant_id, id),
  foreign key (tenant_id, actor_id) references usuarios (tenant_id, id),
  constraint manifiesto_item_documento_ampara_o_baja check (
    (reference_document_id is not null) <> (bajado_motivo is not null)
  ),
  -- Un motivo de una palabra no le dice nada a quien lo lea mañana, que es para quien se escribe.
  constraint manifiesto_item_documento_motivo_util check (
    bajado_motivo is null or length(btrim(bajado_motivo)) >= 3
  )
);
create index manifiesto_item_documento_tenant_item_idx
  on manifiesto_item_documento (tenant_id, manifiesto_item_id);
create index manifiesto_item_documento_tenant_doc_idx
  on manifiesto_item_documento (tenant_id, reference_document_id);
create index manifiesto_item_documento_tenant_actor_idx
  on manifiesto_item_documento (tenant_id, actor_id);

comment on table manifiesto_item_documento is
  'CAPTURA — el acto de amparar un ítem con su DTE, o de BAJARLO del manifiesto con su motivo '
  '(art. 55 DL 825, §7.3). Es una tabla y no dos columnas porque `manifiesto_items` es '
  'append-only y esto ocurre después de contar: son actos, no atributos del conteo.';

-- Append-only, como todo hecho de custodia (§7.4).
revoke update, delete on manifiesto_item_documento from public;
create trigger manifiesto_item_documento_append_only
  before update or delete on manifiesto_item_documento
  for each row execute function rechazar_mutacion_de_hecho();
create trigger manifiesto_item_documento_append_only_truncate
  before truncate on manifiesto_item_documento
  for each statement execute function rechazar_mutacion_de_hecho();

-- ─── POR QUÉ EL GATE NO ES UN CHECK ───────────────────────────────────────────────
--
-- El segundo intento lo escribió como CHECK sobre `manifiesto_items`: «a bordo sin documento no
-- entra». También estaba mal. La fila nace cuando el andén CUENTA y el papel se lee un minuto
-- después: un CHECK ahí rebota el conteo, que es exactamente la captura rechazada que la regla
-- de oro prohíbe (§4.2).
--
-- El art. 55 no dice «no lo anotes»: dice que la mercadería no viaje sin su documento. La regla
-- es sobre lo que SALE, no sobre lo que se registra.

/**
 * Los ítems de un manifiesto que NO pueden viajar: llevan carga y no tienen acto — ni documento
 * que los ampare ni bajada que los saque.
 *
 * `qty_confirmada = 0` no aparece: si no subió nada, no hay mercadería que amparar, y exigirle
 * documento dejaría el manifiesto trabado por una carga que no existe.
 */
create or replace function carga_sin_documento(el_manifiesto uuid)
  returns table (manifiesto_item_id uuid, qty_confirmada int)
  language sql stable as $$
    select mi.id, mi.qty_confirmada
      from manifiesto_items mi
     where mi.manifiesto_id = el_manifiesto
       and mi.qty_confirmada > 0
       and not exists (
         select 1 from manifiesto_item_documento d where d.manifiesto_item_id = mi.id
       )
     order by mi.id;
  $$;

comment on function carga_sin_documento(uuid) is
  'Los ítems que no pueden ir a bordo: con carga y sin acto (art. 55 DL 825, §7.3). NO es un '
  'CHECK a propósito — el conteo del andén ocurre antes de leer el papel, y rebotarlo sería la '
  'captura rechazada que el §4.2 prohíbe. La validación bloqueante corre en el CLIENTE.';

insert into evento_tipo (codigo, descripcion) values
  ('manifiesto.documento_asociado', 'Se asoció un DTE de un tercero a un ítem del manifiesto'),
  ('manifiesto.item_bajado',        'Un ítem se bajó del manifiesto por no tener documento, con su motivo');
