-- 0041 — El sub-manifiesto por parada de carga y POR EMPRESA. [AC-FRUT-07]
--
-- El §5.2 F2 es el flujo del andén a las cuatro de la mañana: PIN, vehículo, «Conforme». Lo que
-- queda escrito de ese momento es esta tabla — y es lo que después sostiene la disputa cuando el
-- cliente dice que faltaron seis bandejas.
--
-- ─── ES CAPTURA, Y NACE APPEND-ONLY ────────────────────────────────────────────────
--
-- El §4.2 pone la custodia en la lista de CAPTURA con todas las letras: el mundo físico ya
-- ocurrió. Un manifiesto que rebote al sincronizar es un traspaso que pasó y del que no queda
-- constancia. Por eso REVOKE UPDATE/DELETE desde el día 1 (§7.4) y no en el AC siguiente: una
-- tabla de hechos que existe mutable aunque sea un commit es una tabla que alguien puede corregir
-- «solo esta vez».
--
-- La corrección es por SUPERSEDE con motivo y autor, y eso lo trae AC-FRUT-09. Acá se cierra la
-- puerta; allá se abre la que corresponde.
--
-- ─── NO HAY BORRADOR: «CONFORME» ES LO QUE LO CREA ────────────────────────────────
--
-- Podría haber un manifiesto en borrador que después se confirma. No lo hay, y es deliberado: un
-- borrador es una fila que dice que hubo un traspaso cuando todavía no lo hubo, y en una tabla
-- append-only no se puede deshacer. El §5.2 F2 pide que «Conforme» sea la ÚNICA confirmación del
-- flujo — el undo de 8 s vive en el cliente, ANTES de que esto exista (§4.7, §0).
--
-- ─── UNO POR PARADA Y POR EMPRESA ──────────────────────────────────────────────────
--
-- El §5.2 F2 lo pide así y no es un detalle de presentación: en una parada de carga consolidada,
-- el responsable de andén cuenta lo de cada panadería por separado porque cada una responde por
-- lo suyo. Un manifiesto único con la suma haría imposible decir de quién faltaron las bandejas —
-- que es exactamente la pregunta que se hace al día siguiente.

create table manifiestos (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  parada_id          uuid        not null,
  empresa_cliente_id uuid        not null,
  -- Doble firma, o UNA si el responsable de carga y el chofer son la misma persona (§4.5).
  -- Las dos nullables porque la firma se resuelve en el momento y este AC solo construye el
  -- sub-manifiesto: quién firma qué es AC-FRUT-09.
  firma_libero_id    uuid,
  firma_recibio_id   uuid,
  -- Doble reloj del §4.6: el del aparato con su huso, y el del servidor al recibir. Sin los dos,
  -- un traspaso sincronizado seis horas después se lee como si hubiera ocurrido al llegar.
  ts_dispositivo     timestamptz not null,
  tz_offset_min      int         not null,
  record_time        timestamptz not null default now(),
  client_uuid        uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Centinela 1: el replay del outbox no crea una segunda fila (§0, §4.7, §9.3.1).
  unique (tenant_id, client_uuid),
  -- UNO por parada y por empresa: dos serían dos conteos del mismo andén sin forma de saber
  -- cuál vale.
  unique (tenant_id, parada_id, empresa_cliente_id),
  foreign key (tenant_id, parada_id) references paradas (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  foreign key (tenant_id, firma_libero_id) references firmas (tenant_id, id),
  foreign key (tenant_id, firma_recibio_id) references firmas (tenant_id, id)
);
create index manifiestos_tenant_parada_idx on manifiestos (tenant_id, parada_id);
create index manifiestos_tenant_empresa_idx on manifiestos (tenant_id, empresa_cliente_id);
create index manifiestos_tenant_libero_idx on manifiestos (tenant_id, firma_libero_id);
create index manifiestos_tenant_recibio_idx on manifiestos (tenant_id, firma_recibio_id);

comment on table manifiestos is
  'CAPTURA — sub-manifiesto por parada de carga y POR EMPRESA (§4.5, §5.2 F2). El mundo físico '
  'ya ocurrió: jamás rebota al sincronizar, y no se edita — la corrección es supersede.';

create table manifiesto_items (
  id             uuid not null default uuidv7(),
  tenant_id      uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  manifiesto_id  uuid not null,
  item_id        uuid not null,
  -- Lo DECLARADO: lo que la planificación dijo que iba. Se copia acá y no se lee de `items`
  -- porque el manifiesto tiene que seguir diciendo contra qué se contó, aunque la planificación
  -- cambie después. Un contraste que se recalcula no es un contraste.
  qty_declarada  int  not null,
  -- Lo CONTADO en el andén. Puede diferir, y esa diferencia es el dato (§5.2 F2).
  qty_confirmada int  not null,
  -- Generada: la discrepancia no se escribe, se deriva. Escrita a mano sería un tercer número
  -- que puede no cuadrar con los otros dos.
  discrepancia   int generated always as (qty_confirmada - qty_declarada) stored,
  nota           text,
  primary key (id),
  unique (tenant_id, id),
  -- Un ítem entra una sola vez en su manifiesto.
  unique (tenant_id, manifiesto_id, item_id),
  foreign key (tenant_id, manifiesto_id) references manifiestos (tenant_id, id),
  foreign key (tenant_id, item_id) references items (tenant_id, id),
  constraint manifiesto_items_declarada_positiva check (qty_declarada > 0),
  -- Cero es válido: «no subió nada de esto» es una respuesta del andén, y la más importante.
  constraint manifiesto_items_confirmada_no_negativa check (qty_confirmada >= 0)
);
create index manifiesto_items_tenant_manifiesto_idx on manifiesto_items (tenant_id, manifiesto_id);
create index manifiesto_items_tenant_item_idx on manifiesto_items (tenant_id, item_id);
-- Para la consulta que de verdad se hace: «qué discrepancias hubo hoy».
create index manifiesto_items_tenant_discrepancia_idx
  on manifiesto_items (tenant_id, manifiesto_id) where discrepancia <> 0;

comment on table manifiesto_items is
  'CAPTURA — lo declarado contra lo contado, por ítem (§5.2 F2). `discrepancia` es GENERADA: '
  'escrita a mano sería un tercer número que puede no cuadrar con los otros dos.';

comment on column manifiesto_items.qty_declarada is
  'Lo que la planificación dijo que iba, COPIADO al confirmar. No se lee de `items` porque el '
  'manifiesto tiene que seguir diciendo contra qué se contó: un contraste que se recalcula no '
  'es un contraste.';

-- Append-only desde el día 1 (§7.4). La corrección por supersede la trae AC-FRUT-09; acá se
-- cierra la puerta, porque una tabla de hechos que existe mutable aunque sea un commit es una
-- tabla que alguien puede corregir «solo esta vez».
revoke update, delete on manifiestos, manifiesto_items from public;

create trigger manifiestos_append_only
  before update or delete on manifiestos
  for each row execute function rechazar_mutacion_de_hecho();
create trigger manifiestos_append_only_truncate
  before truncate on manifiestos
  for each statement execute function rechazar_mutacion_de_hecho();

create trigger manifiesto_items_append_only
  before update or delete on manifiesto_items
  for each row execute function rechazar_mutacion_de_hecho();
create trigger manifiesto_items_append_only_truncate
  before truncate on manifiesto_items
  for each statement execute function rechazar_mutacion_de_hecho();

-- El confinamiento del §7.2: el contratante ve SU sub-manifiesto y ninguno más. Sin esto, el
-- invariante de `suite-bd/confinamiento.test.mjs` se pone rojo — y con razón, porque cuánto
-- cargó la competencia en el mismo andén es exactamente lo que no puede saber.
select aplicar_rls_de_empresa('manifiestos');

insert into evento_tipo (codigo, descripcion) values
  ('manifiesto.confirmado',   'Se confirmó el sub-manifiesto de una empresa en una parada de carga'),
  ('manifiesto.discrepancia', 'El conteo del andén no coincidió con lo declarado');
