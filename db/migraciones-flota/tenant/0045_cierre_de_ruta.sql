-- 0045 — La ecuación de cierre por empresa, calculada por la base. [AC-FRUT-11]
--
-- `cargado = entregado + devuelto + faltante declarado`, para CADA empresa de la ruta (§3.E1.6,
-- §4.5, §5.2 F5). Es el patrón de reconciliación diaria del §6 (Bimbo DSD): al final del día
-- alguien tiene que poder decir dónde quedó cada bulto que subió al camión, y la única respuesta
-- que sirve es una que cierre — «se perdieron tres» es una respuesta; «no sé» no lo es.
--
-- ─── POR QUÉ UNA FUNCIÓN, Y POR QUÉ SECURITY DEFINER ──────────────────────────────
--
-- La ecuación es una REGLA DE NEGOCIO, y las reglas de negocio viven en la base (§4.5 la pide
-- así con todas las letras). Escrita en TypeScript tendría dos copias el día que el portal del
-- contratante (módulo 07) muestre su propia fila, y dos copias de una reconciliación se separan
-- —siempre en el tercer decimal, siempre el mes que alguien reclama—.
--
-- SECURITY DEFINER porque los términos viven en tablas que no todo el que necesita el RESULTADO
-- puede leer: `manifiesto_items` dice cuánto cargó cada empresa en el mismo andén, y el §3.E1.10
-- prohíbe que un contratante lo vea. La función entrega el renglón sin abrir la tabla.
--
-- Y por eso mismo el filtro del rol `cliente` va ESCRITO ADENTRO: bajo SECURITY DEFINER la
-- política de `aplicar_rls_de_empresa` no corre —el dueño de las tablas no la sufre—, así que
-- confiar en ella acá sería exactamente el agujero que el módulo 00 cerró. El privilegio lo da
-- el DEFINER; la ceguera hay que escribirla.
--
-- ─── DE DÓNDE SALE CADA TÉRMINO ───────────────────────────────────────────────────
--
--   · `cargado`   — lo CONTADO en el andén: `manifiesto_items.qty_confirmada` de los
--     sub-manifiestos de las paradas de carga de la ruta (§5.2 F2). Lo contado y no lo
--     declarado: la ecuación reconcilia lo que subió al camión, no lo que la planificación
--     dijo que iba a subir.
--   · `entregado` — `items.qty_entregada` de las paradas de entrega. La columna vive en ESTE
--     módulo y la ESCRIBE el módulo 04 al capturar el POD (spec 03 §1); en CI se fixturea, que
--     es lo que la propia spec fija para los ACs de este módulo.
--   · `devuelto` y `faltante` — DECLARADOS al cierre, en `cierre_ruta_empresa`. Son el resultado
--     de la clasificación táctil del §5.2 F5: la diferencia se asigna a uno de los dos, que son
--     los términos de la propia ecuación. Sin cierre todavía, los dos valen cero y la ruta
--     aparece descuadrada por el total pendiente — que es la verdad.
--
-- AC-FRUT-21 materializa filas de `devoluciones` desde el término `devuelto` que se declara acá.
-- El orden es ese y no al revés: la clasificación ocurre en el cierre, y la tabla de devoluciones
-- guarda su detalle (empresa, ítems, motivo). Esta migración no la crea ni la supone.

create table cierres_ruta (
  id             uuid        not null default uuidv7(),
  tenant_id      uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  ruta_id        uuid        not null,
  -- El turno cuya config CONGELADA juzga esta captura (§4.4). Nullable: un cierre puede llegar
  -- por sync desde un aparato que ya cerró su turno, y perder el cierre por eso sería rebotar.
  turno_id       uuid,
  -- Doble reloj del §4.6: sin el del aparato, un cierre sincronizado a la mañana siguiente se
  -- lee como si la ruta se hubiera cerrado a esa hora.
  ts_dispositivo timestamptz not null,
  tz_offset_min  int         not null,
  record_time    timestamptz not null default now(),
  client_uuid    uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Centinela 1: el replay del outbox no cierra la ruta dos veces (§9.3.1).
  unique (tenant_id, client_uuid),
  -- UN cierre por ruta. Dos serían dos reconciliaciones del mismo día sin forma de saber cuál
  -- vale, y como la tabla es append-only tampoco se podría elegir después.
  unique (tenant_id, ruta_id),
  foreign key (tenant_id, ruta_id) references rutas (tenant_id, id),
  foreign key (tenant_id, turno_id) references turnos (tenant_id, id)
);
create index cierres_ruta_tenant_ruta_idx on cierres_ruta (tenant_id, ruta_id);
create index cierres_ruta_tenant_turno_idx on cierres_ruta (tenant_id, turno_id);

comment on table cierres_ruta is
  'CAPTURA — el cierre de la ruta con su ecuación de custodia por empresa (§4.5, §5.2 F5). El '
  'día ya terminó: jamás rebota al sincronizar. Un cierre descuadrado que llegue por sync entra '
  'igual, con su flag, su evento y su fila en «Por revisar» (§4.2).';

-- NINGUNA columna de dinero, y no es un olvido: el §4.8 y el §5.2 F5 dicen que el chofer ve km,
-- bultos y SOC y JAMÁS CLP. Que la tabla del cierre no tenga dónde guardar un peso es la forma
-- más barata de que ninguna pantalla de este flujo pueda mostrarlo.

create table cierre_ruta_empresa (
  id                 uuid not null default uuidv7(),
  tenant_id          uuid not null default tenant_actual() check (tenant_id = tenant_actual()),
  cierre_id          uuid not null,
  empresa_cliente_id uuid not null,
  -- Los dos términos que declara la clasificación táctil (§5.2 F5). En BULTOS, enteros: la
  -- unidad de `items` y de `manifiesto_items`, para que la resta no tenga que convertir nada.
  devuelto           int  not null default 0,
  faltante           int  not null default 0,
  primary key (id),
  unique (tenant_id, id),
  -- Una sola declaración por empresa dentro de un cierre.
  unique (tenant_id, cierre_id, empresa_cliente_id),
  foreign key (tenant_id, cierre_id) references cierres_ruta (tenant_id, id),
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id),
  constraint cierre_ruta_empresa_devuelto_no_negativo check (devuelto >= 0),
  constraint cierre_ruta_empresa_faltante_no_negativo check (faltante >= 0)
);
create index cierre_ruta_empresa_tenant_cierre_idx on cierre_ruta_empresa (tenant_id, cierre_id);
create index cierre_ruta_empresa_tenant_empresa_idx
  on cierre_ruta_empresa (tenant_id, empresa_cliente_id);

comment on table cierre_ruta_empresa is
  'CAPTURA — lo que la clasificación táctil del descuadre asignó a `devuelto` y a `faltante '
  'declarado` para cada empresa de la ruta (§5.2 F5, §4.2). Son términos de la ecuación, no un '
  'comentario sobre ella: por eso se guardan y no se recalculan.';

comment on column cierre_ruta_empresa.devuelto is
  'Bultos que volvieron. AC-FRUT-21 materializa desde acá las filas de `devoluciones` con su '
  'empresa, sus ítems y su motivo de catálogo; este número es el total que aquellas detallan.';

-- Append-only por las dos capas del §7.4: el REVOKE al rol de app y el trigger, que detiene
-- también a quien tenga más privilegios. Los dos responden 42501. Un cierre que se pudiera
-- editar es una reconciliación que se puede hacer cuadrar después de los hechos.
revoke update, delete on cierres_ruta, cierre_ruta_empresa from public;

create trigger cierres_ruta_append_only
  before update or delete on cierres_ruta
  for each row execute function rechazar_mutacion_de_hecho();
create trigger cierres_ruta_append_only_truncate
  before truncate on cierres_ruta
  for each statement execute function rechazar_mutacion_de_hecho();

create trigger cierre_ruta_empresa_append_only
  before update or delete on cierre_ruta_empresa
  for each row execute function rechazar_mutacion_de_hecho();
create trigger cierre_ruta_empresa_append_only_truncate
  before truncate on cierre_ruta_empresa
  for each statement execute function rechazar_mutacion_de_hecho();

-- El confinamiento del §7.2 sobre la tabla que tiene la columna. `cierres_ruta` no la tiene y no
-- se le agrega una: un cierre es de la RUTA, y la ruta el contratante no la ve nunca (§3.E1.10,
-- migración 0040) — su renglón de la ecuación se lo entrega la función, que sabe filtrarlo.
select aplicar_rls_de_empresa('cierre_ruta_empresa');

/**
 * La ecuación de custodia de una ruta, POR EMPRESA (§3.E1.6, §4.5, §5.2 F5).
 *
 * `cargado = entregado + devuelto + faltante`; `diferencia` es lo que sobra de ese lado izquierdo
 * y es CERO cuando cuadra. Positiva: subió más de lo que se sabe dónde quedó. Negativa: se
 * entregó o se declaró más de lo que subió — que también es un descuadre y también hay que verlo.
 *
 * Devuelve una fila por empresa con carga o con ítems en la ruta, incluso si todos sus números
 * son cero: una empresa que desaparece de la lista es una que nadie reconcilia.
 */
create or replace function ecuacion_de_cierre(p_ruta_id uuid)
  returns table (
    empresa_cliente_id uuid,
    empresa            text,
    cargado            int,
    entregado          int,
    devuelto           int,
    faltante           int,
    diferencia         int
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with cargado as (
    select m.empresa_cliente_id as empresa_id, sum(mi.qty_confirmada)::int as bultos
      from manifiestos m
      join paradas p on p.id = m.parada_id and p.tenant_id = m.tenant_id
      join manifiesto_items mi on mi.manifiesto_id = m.id and mi.tenant_id = m.tenant_id
     where p.ruta_id = p_ruta_id and p.tipo = 'carga' and m.tenant_id = tenant_actual()
     group by m.empresa_cliente_id
  ),
  entregado as (
    -- `qty_entregada` la escribe el módulo 04 al capturar el POD; acá solo se lee. NULL es
    -- «todavía no se supo», y suma cero: una parada sin visitar no es una entrega de cero
    -- bultos, pero para la reconciliación del día pesa igual — la ruta no cuadra hasta que
    -- alguien diga qué pasó con esos bultos.
    select i.empresa_cliente_id as empresa_id, sum(coalesce(i.qty_entregada, 0))::int as bultos
      from items i
      join paradas p on p.id = i.parada_id and p.tenant_id = i.tenant_id
     where p.ruta_id = p_ruta_id and p.tipo = 'entrega' and i.tenant_id = tenant_actual()
     group by i.empresa_cliente_id
  ),
  declarado as (
    select cre.empresa_cliente_id as empresa_id,
           sum(cre.devuelto)::int as devuelto,
           sum(cre.faltante)::int as faltante
      from cierre_ruta_empresa cre
      join cierres_ruta c on c.id = cre.cierre_id and c.tenant_id = cre.tenant_id
     where c.ruta_id = p_ruta_id and c.tenant_id = tenant_actual()
     group by cre.empresa_cliente_id
  ),
  empresas as (
    select empresa_id from cargado
    union
    select empresa_id from entregado
    union
    select empresa_id from declarado
  )
  select e.empresa_id,
         ec.razon_social,
         coalesce(ca.bultos, 0),
         coalesce(en.bultos, 0),
         coalesce(de.devuelto, 0),
         coalesce(de.faltante, 0),
         coalesce(ca.bultos, 0)
           - coalesce(en.bultos, 0) - coalesce(de.devuelto, 0) - coalesce(de.faltante, 0)
    from empresas e
    join empresas_cliente ec on ec.id = e.empresa_id and ec.tenant_id = tenant_actual()
    left join cargado   ca on ca.empresa_id = e.empresa_id
    left join entregado en on en.empresa_id = e.empresa_id
    left join declarado de on de.empresa_id = e.empresa_id
   -- El confinamiento del §7.2 ESCRITO A MANO, porque bajo SECURITY DEFINER la política de
   -- `aplicar_rls_de_empresa` no corre: el dueño de las tablas no la sufre. Un contratante ve su
   -- renglón y ninguno más — cuánto cargó la competencia en el mismo andén es exactamente lo que
   -- el §3.E1.10 le niega.
   where nullif(current_setting('app.current_role', true), '') is distinct from 'cliente'
      or e.empresa_id::text = nullif(current_setting('app.current_empresa', true), '')
   order by ec.razon_social;
$$;

comment on function ecuacion_de_cierre(uuid) is
  'La ecuación de custodia por empresa de una ruta: cargado = entregado + devuelto + faltante '
  '(§3.E1.6, §4.5, §5.2 F5) [AC-FRUT-11]. SECURITY DEFINER para entregar el renglón sin abrir '
  '`manifiesto_items` a quien no puede leerla; el confinamiento del rol `cliente` va escrito '
  'adentro porque bajo DEFINER la política de RLS no corre.';

insert into evento_tipo (codigo, descripcion) values
  ('cierre.ruta_cerrada',
   'Se cerró la ruta con su ecuación de custodia por empresa (§5.2 F5)'),
  ('cierre.descuadrado',
   'Llegó por sync un cierre de ruta cuya ecuación no cuadra para alguna empresa; entró igual');
