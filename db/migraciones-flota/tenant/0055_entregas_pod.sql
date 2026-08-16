-- 0055 — `entregas_pod`: la fila donde aterriza el POD, write-once con supersede. [AC-FPOD-11]
--
-- Fuente: §4.5 (`entregas_pod` write-once con supersede + `UNIQUE(encargo) WHERE cerrada AND
-- supersede IS NULL`) · §4.2 (la clase de la regla de oro: CAPTURA) · §4.6 (doble reloj y
-- `client_uuid`) · §7.4 (append-only: REVOKE UPDATE/DELETE + trigger; corrección = supersede
-- con motivo y autor) · §9.3.6 (centinela 6: UPDATE/DELETE como rol de app ⇒ 42501, supersede
-- ⇒ 2 filas con la original intacta).
--
-- ─── POR QUÉ ESTA TABLA NO NACIÓ CON EL LOTE TRANSVERSAL DE LA 0002 ──────────────
--
-- `eventos`, `evidence`, `client_metric` y `review_queue` son de TODOS los hitos y por eso el
-- módulo 00 las crea en la plantilla (AC-FTEN-24). `entregas_pod` no: es del POD y de nadie
-- más, y su forma depende de la máquina de la parada (§4.5) que el hito (d) recién dejó
-- escrita. Crearla antes habría sido inventarle columnas al hito que todavía no existía —
-- exactamente lo que el §4.1 evita poniendo cada tabla en el hito de su dueño.
--
-- ─── QUÉ GUARDA, Y POR QUÉ NO ALCANZA CON `paradas` ──────────────────────────────
--
-- `paradas` es el estado VISIBLE: se proyecta, se corrige, se cancela — es planificación que
-- el terreno cierra. `entregas_pod` es el HECHO: lo que el chofer reportó, tal como lo
-- reportó, y no se toca nunca más. Que las dos lleven `resultado` y `motivo_id` no es
-- duplicación: una es la conclusión vigente y la otra es la declaración que la originó. El
-- día que una corrección cambie la conclusión, la declaración original tiene que seguir
-- diciendo lo que dijo — si no, la liquidación del §3.E1.9, que nace de la evidencia, se
-- calcularía contra una historia reescrita.
--
-- ─── LO QUE ESTE AC NO TRAE, A PROPÓSITO ─────────────────────────────────────────
--
-- Ninguna CONDUCTA. Quién escribe estas filas por el motor de sync, el candado del servidor
-- sobre el POD sin manifiesto confirmado y el camino feliz completo son AC-FRUT-23, que
-- estaba bloqueado justamente esperando este DDL. El transporte del binario y su sha256
-- (`evidence.sha256`, mismatch ⇒ flag jamás rebote) es AC-FPOD-19. Y la fila de `evidence`
-- del camino feliz sigue esperando la respuesta del dueño a la Pregunta 4 de la spec 04: acá
-- no se adelanta ni se inventa un tipo de evidencia que nadie decidió.

create table entregas_pod (
  id               uuid             not null default uuidv7(),
  tenant_id        uuid             not null default tenant_actual() check (tenant_id = tenant_actual()),
  -- El encargo es el sujeto de la unicidad del §4.5; la parada es DÓNDE ocurrió. Los dos son
  -- obligatorios: un POD sin encargo no le sirve a la liquidación y uno sin parada no le
  -- sirve a la proyección.
  encargo_id       uuid             not null,
  parada_id        uuid             not null,
  -- La máquina del §4.5, sin alias de UI: «entregado / no entregado» son palabras de la
  -- pantalla y jamás nombres de esquema (§2).
  resultado        parada_resultado not null,
  -- `dejado_en_punto` viaja acá, no como motivo de no-entrega: el §4.5 lo declara entrega
  -- EFECTUADA de primera clase.
  metodo_entrega   text,
  -- El motivo de catálogo de la no-entrega (§4.5). Nullable: la entrega feliz no tiene por
  -- qué explicarse.
  motivo_id        uuid,
  -- `cerrada` es la palabra del §4.5 y es lo que hace parcial al índice de abajo: una
  -- captura que todavía no cierra la parada no compite por la unicidad.
  cerrada          boolean          not null default true,
  -- La corrección del §7.4: una fila NUEVA que apunta a la que corrige. Nunca un UPDATE.
  supersede_id     uuid,
  -- «Supersede con motivo y AUTOR» (§7.4). El esquema lo exige, no la aplicación: una
  -- corrección anónima o sin razón es indistinguible de una adulteración.
  supersede_motivo text,
  actor_id         uuid,
  dispositivo_id   uuid,
  -- Doble reloj del §4.6: cuándo tocó «Entregado» el chofer, con su huso, y cuándo lo supo
  -- el servidor. Sin los dos, una captura offline de anteayer se lee como de hoy.
  event_time       timestamptz      not null,
  tz_offset_min    int              not null,
  record_time      timestamptz      not null default now(),
  -- Idempotencia del §0: el replay del outbox reintenta el mismo hecho hasta que el servidor
  -- confirma, y sin esta llave cada reintento sería una entrega más.
  client_uuid      uuid,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, encargo_id) references encargos (tenant_id, id),
  foreign key (tenant_id, parada_id) references paradas (tenant_id, id),
  foreign key (tenant_id, motivo_id) references motivos (tenant_id, id),
  foreign key (tenant_id, supersede_id) references entregas_pod (tenant_id, id),
  -- Una fila que se supersede a sí misma es una cadena de corrección que nunca termina.
  constraint entregas_pod_supersede_no_se_apunta check (supersede_id is distinct from id),
  constraint entregas_pod_supersede_con_motivo_y_autor check (
    supersede_id is null
    or (length(btrim(coalesce(supersede_motivo, ''))) > 0 and actor_id is not null)
  ),
  -- Y al revés: un motivo de corrección sin corrección que explicar es ruido que después
  -- alguien lee como si hubiera habido una.
  constraint entregas_pod_motivo_solo_al_superseder check (
    supersede_id is not null or supersede_motivo is null
  )
);

-- El write-once del §4.5, LITERAL: `UNIQUE(encargo) WHERE cerrada AND supersede IS NULL`. Es
-- parcial y no un UNIQUE a secas porque las correcciones tienen que poder convivir con la
-- original — si no, «corregir es insertar otra fila» chocaría contra la unicidad y la única
-- salida sería el UPDATE que el §7.4 prohíbe. La fila corregida sigue ocupando el índice: es
-- ella la que declaró el cierre, y la conclusión vigente se lee siguiendo la cadena.
create unique index entregas_pod_una_vigente_por_encargo
  on entregas_pod (tenant_id, encargo_id) where cerrada and supersede_id is null;

-- Los índices de las FK. El de arriba es PARCIAL y no sirve para esto: un borrado en el padre
-- tiene que poder mirar TODAS las filas hijas, incluidas las superseded, y con solo el índice
-- parcial cada uno de esos borrados sería un scan completo de la tabla de PODs (§9.2).
create index entregas_pod_tenant_encargo_idx on entregas_pod (tenant_id, encargo_id);
create index entregas_pod_tenant_parada_idx on entregas_pod (tenant_id, parada_id);
create index entregas_pod_tenant_motivo_idx on entregas_pod (tenant_id, motivo_id);
create index entregas_pod_tenant_supersede_idx on entregas_pod (tenant_id, supersede_id);

comment on table entregas_pod is
  'CAPTURA — el POD tal como lo reportó el terreno, write-once. Entra siempre (2xx + flag, '
  '§4.2) y no se edita jamás: corregir es una fila nueva con `supersede_id`, motivo y autor '
  '(§4.5, §7.4).';

-- Append-only por los DOS caminos del §7.4, igual que los hechos de la 0002: el trigger
-- detiene también al migrador y a un psql a mano, y `db/flota/rol-app.mjs` deriva de la
-- PRESENCIA de este trigger el REVOKE UPDATE/DELETE al rol `app_t_<slug>` — por eso no hay
-- una lista de tablas que mantener en dos lados. Los dos caminos rebotan con el mismo 42501
-- que pide el centinela 6.
create trigger entregas_pod_append_only
  before update or delete on entregas_pod
  for each row execute function rechazar_mutacion_de_hecho();
create trigger entregas_pod_append_only_truncate
  before truncate on entregas_pod
  for each statement execute function rechazar_mutacion_de_hecho();
