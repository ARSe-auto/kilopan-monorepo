-- 0009 — Configuración versionada y congelada (§4.4). [AC-FTEN-13]
--
-- El dueño cerró la granularidad el 09-ago-2026 (Pregunta 4): **snapshot GLOBAL por tenant**.
-- Una fila de `config_version` por cada cambio, que congela TODA la configuración —tema,
-- terminología, entitlements efectivos, parámetros y plantilla de vertical— y a la que
-- `turno.config_version_id` apunta.
--
-- Es lo único que hace literalmente cierto el «un turno corre entero con UNA versión» del
-- §4.4: con versiones por tabla, un turno abierto podría estar corriendo con la terminología
-- de ayer y los parámetros de hoy. Y el drill-down desde un turno viejo pasa a ser UNA lectura
-- en vez de reconstruir un snapshot desde N punteros.
--
-- QUÉ ENTRA EN EL SNAPSHOT no está escrito en la función: está en `config_versionada`, una
-- fila por tabla. Una lista dentro del código se desincronizaría con la primera tabla de
-- configuración que agregue otro AC, y el snapshot quedaría incompleto sin que nadie lo note.

create table config_versionada (
  tabla text not null primary key,
  ac    text not null
);
comment on table config_versionada is
  'PLANIFICACIÓN — qué tablas entran al snapshot de configuración. Una fila por tabla, para '
  'que agregar configuración sea un acto visible y no un olvido.';

-- linter: exenta config_versionada — es el registro del mecanismo de versionado, no una tabla
-- de dominio: no lleva datos de ningún tenant, solo nombres de tablas.

insert into config_versionada (tabla, ac) values
  ('parametros',        'AC-FTEN-12'),
  ('vertical_template', 'AC-FTEN-12'),
  ('grupos',            'AC-FTEN-12');

-- `config_version` es APPEND-ONLY (§7.4) y esa es la mitad importante del AC: una versión ya
-- referenciada por un turno JAMÁS se altera. Si se pudiera editar, «congelada» sería una forma
-- de hablar y el turno de la semana pasada cambiaría de reglas retroactivamente.
create table config_version (
  id        uuid        not null default uuidv7(),
  tenant_id uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  motivo    text        not null,
  snapshot  jsonb       not null,
  creada_en timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  constraint config_version_motivo_no_vacio check (length(btrim(motivo)) > 0)
);
-- El índice es por `creada_en` porque las consultas del panel preguntan «qué regía el día X».
-- Pero el ORDEN autoritativo entre dos versiones es el `id`: dentro de una transacción `now()`
-- está congelado y dos versiones selladas seguidas comparten timestamp al milisegundo. El
-- UUIDv7 sí es monotónico, y para eso lo exige el §0.
create index config_version_tenant_creada_idx on config_version (tenant_id, creada_en desc);
comment on table config_version is
  'CAPTURA — snapshot GLOBAL e inmutable de la configuración del tenant (§4.4, respuesta del '
  'dueño a la Pregunta 4). Append-only: una versión referenciada por un turno no se altera.';

create trigger config_version_append_only
  before update or delete on config_version
  for each row execute function rechazar_mutacion_de_hecho();
create trigger config_version_append_only_truncate
  before truncate on config_version
  for each statement execute function rechazar_mutacion_de_hecho();

/**
 * Congela la configuración vigente en una versión nueva. Devuelve su id.
 *
 * No muta ninguna versión anterior: sella lo que hay AHORA. Los entitlements efectivos vienen
 * de `control` (Pregunta 3) y se pasan como argumento en vez de leerse acá — una consulta
 * cross-database en runtime está prohibida (§4.1, §7.2), y quien llama ya tiene esa conexión
 * abierta porque el ruteo la usó para resolver el subdominio.
 */
create or replace function crear_config_version(p_motivo text, p_entitlements jsonb default '{}'::jsonb)
  returns uuid
  language plpgsql as $$
  declare
    v_snapshot jsonb := jsonb_build_object('entitlements', p_entitlements);
    v_tabla    text;
    v_filas    jsonb;
  begin
    for v_tabla in select tabla from config_versionada order by tabla loop
      execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id), ''[]''::jsonb) from %I t', v_tabla)
        into v_filas;
      v_snapshot := v_snapshot || jsonb_build_object(v_tabla, v_filas);
    end loop;

    insert into config_version (motivo, snapshot) values (p_motivo, v_snapshot)
      returning id into v_tabla;
    return v_tabla::uuid;
  end
  $$;

comment on function crear_config_version(text, jsonb) is
  'Congela la configuración vigente en una versión nueva y devuelve su id. Recorre '
  '`config_versionada`, así que agregar una tabla de configuración es una fila y no un parche '
  'a esta función.';
