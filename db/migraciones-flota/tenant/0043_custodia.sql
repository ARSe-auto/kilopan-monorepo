-- 0043 — El traspaso de custodia, y la corrección que no borra. [AC-FRUT-09]
--
-- El momento en que la mercadería deja de ser responsabilidad del andén y pasa a ser del
-- chofer. Es lo que sostiene la disputa tres semanas después: sin esta fila, «yo la entregué
-- completa» y «a mí me la dieron así» son dos afirmaciones sin nada en medio.
--
-- ─── DOBLE FIRMA, O UNA SI ES LA MISMA PERSONA ────────────────────────────────────
--
-- El §4.5 lo dice así, y la excepción no es una comodidad: en un milk-run el que carga y el que
-- maneja son la misma persona, y pedirle dos firmas la obligaría a inventar una segunda — que
-- es exactamente lo que vacía de sentido a la primera. El CHECK deja pasar los dos casos y
-- ninguno más: dos firmas distintas, o una sola cuando quien libera y quien recibe coinciden.
--
-- ─── LA CORRECCIÓN NO BORRA: SUPERSEDE (centinela 6) ──────────────────────────────
--
-- Un traspaso mal registrado no se edita ni se borra — se SUPERSEDE con una fila nueva que
-- apunta a la anterior, con su motivo y su autor. Quedan dos filas y la original intacta. Es la
-- diferencia entre una corrección auditable y una que nadie puede distinguir de un encubrimiento:
-- si la primera desapareciera, nada probaría que alguna vez dijo otra cosa.
--
-- El `unique … where supersede_de is null` es lo que hace que «vigente» tenga UN significado: un
-- traspaso corregido deja de ser el vigente en el mismo acto en que nace su reemplazo, sin que
-- ninguna consulta tenga que saber la regla.

create table custody_transfer (
  id                 uuid        not null default uuidv7(),
  tenant_id          uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  manifiesto_id      uuid        not null,
  -- DE quién a quién. Personas y no usuarios: quien entrega la carga responde como persona, y
  -- su usuario puede desactivarse mañana sin que el traspaso deje de haber ocurrido.
  de_persona_id      uuid        not null,
  a_persona_id       uuid        not null,
  -- Las dos firmas del §4.5. `firma_recibio_id` es obligatoria —alguien recibió— y
  -- `firma_libero_id` puede ser la MISMA cuando quien carga y quien maneja coinciden.
  firma_libero_id    uuid        not null,
  firma_recibio_id   uuid        not null,
  -- El §4.6 lo nombra sin fijarle semántica; la **pregunta 5** de la spec 03 sigue abierta sobre
  -- si puede ser obligatorio según cargo_type. Hoy es texto opcional: el número del sello físico
  -- del vehículo o del bulto, si esa operación los usa.
  sello              text,
  -- Doble reloj del §4.6: sin el del aparato, un traspaso sincronizado seis horas después se
  -- lee como si hubiera ocurrido al llegar.
  ts_dispositivo     timestamptz not null,
  tz_offset_min      int         not null,
  record_time        timestamptz not null default now(),
  -- La corrección del centinela 6: apunta a la fila que reemplaza, con su motivo y su autor.
  supersede_de       uuid,
  supersede_motivo   text,
  supersede_autor_id uuid,
  client_uuid        uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Centinela 1: el replay del outbox no crea una segunda fila (§9.3.1).
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, manifiesto_id) references manifiestos (tenant_id, id),
  foreign key (tenant_id, de_persona_id) references personas (tenant_id, id),
  foreign key (tenant_id, a_persona_id) references personas (tenant_id, id),
  foreign key (tenant_id, firma_libero_id) references firmas (tenant_id, id),
  foreign key (tenant_id, firma_recibio_id) references firmas (tenant_id, id),
  foreign key (tenant_id, supersede_de) references custody_transfer (tenant_id, id),
  foreign key (tenant_id, supersede_autor_id) references usuarios (tenant_id, id),
  -- Una corrección sin motivo y sin autor es indistinguible de un encubrimiento: las tres
  -- columnas viajan juntas o no viaja ninguna.
  constraint custody_transfer_supersede_completo check (
    (supersede_de is null and supersede_motivo is null and supersede_autor_id is null)
    or (supersede_de is not null and supersede_autor_id is not null
        and length(btrim(coalesce(supersede_motivo, ''))) >= 3)
  ),
  -- Dos firmas distintas, o UNA sola cuando quien libera y quien recibe son la misma persona
  -- (§4.5). Pedirle dos firmas a quien carga y maneja lo obligaría a inventar la segunda.
  constraint custody_transfer_firma_segun_personas check (
    (de_persona_id <> a_persona_id and firma_libero_id <> firma_recibio_id)
    or (de_persona_id = a_persona_id and firma_libero_id = firma_recibio_id)
  )
);
create index custody_transfer_tenant_manifiesto_idx on custody_transfer (tenant_id, manifiesto_id);
create index custody_transfer_tenant_de_idx on custody_transfer (tenant_id, de_persona_id);
create index custody_transfer_tenant_a_idx on custody_transfer (tenant_id, a_persona_id);
create index custody_transfer_tenant_libero_idx on custody_transfer (tenant_id, firma_libero_id);
create index custody_transfer_tenant_recibio_idx on custody_transfer (tenant_id, firma_recibio_id);
create index custody_transfer_tenant_supersede_idx on custody_transfer (tenant_id, supersede_de);
create index custody_transfer_tenant_autor_idx on custody_transfer (tenant_id, supersede_autor_id);

-- UN traspaso vigente por manifiesto. El parcial es lo que le da un solo significado a
-- «vigente»: el corregido deja de serlo en el mismo acto en que nace su reemplazo, sin que
-- ninguna consulta tenga que conocer la regla.
create unique index custody_transfer_uno_vigente_por_manifiesto
  on custody_transfer (tenant_id, manifiesto_id)
  where supersede_de is null;

comment on table custody_transfer is
  'CAPTURA — el traspaso de la carga del andén al chofer (§4.5, §4.6, §5.2 F2). Append-only: la '
  'corrección es un SUPERSEDE con motivo y autor que deja DOS filas y la original intacta '
  '(centinela 6). Si la primera desapareciera, nada probaría que alguna vez dijo otra cosa.';

comment on column custody_transfer.sello is
  'El §4.6 lo nombra sin fijarle semántica y la pregunta 5 de la spec 03 sigue abierta sobre si '
  'puede ser obligatorio según cargo_type. Hoy es texto opcional: nada acá lo decide por el dueño.';

-- Append-only por las dos capas del §7.4: el REVOKE al rol de app y el trigger, que detiene
-- también a quien tenga más privilegios. Los dos responden 42501.
revoke update, delete on custody_transfer from public;
create trigger custody_transfer_append_only
  before update or delete on custody_transfer
  for each row execute function rechazar_mutacion_de_hecho();
create trigger custody_transfer_append_only_truncate
  before truncate on custody_transfer
  for each statement execute function rechazar_mutacion_de_hecho();

insert into evento_tipo (codigo, descripcion) values
  ('custodia.traspasada', 'La carga pasó del responsable de andén al chofer, con sus firmas'),
  ('custodia.corregida',  'Se superseded un traspaso de custodia con motivo y autor');
