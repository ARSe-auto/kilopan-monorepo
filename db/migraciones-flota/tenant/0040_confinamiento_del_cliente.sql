-- 0040 — El rol `cliente`, confinado a SU empresa por política de BD. [AC-FRUT-12]
--
-- El §7.2 y el §9.3.3 lo piden con esas palabras: «dentro del tenant, sesión `cliente` de la
-- empresa X ⇒ 0 filas de la empresa Y en toda tabla del módulo». Y el §3.E1.10 dice qué NO ve
-- ese rol: otras empresas, rutas completas, telemetría EV, economía del negocio.
--
-- ─── POR QUÉ ESTO NO PUEDE VIVIR EN UN `where` DEL SERVIDOR ────────────────────────
--
-- Un `where empresa_cliente_id = $1` en cada consulta funciona hasta que alguien escriba la
-- consulta número treinta y uno. Y esa es exactamente la que va a existir: el portal del
-- contratante (módulo 07) trae pantallas nuevas sobre estas mismas tablas, escritas meses
-- después por alguien que no leyó esta migración. Con la política en la BD, la consulta que se
-- olvide del `where` devuelve cero filas de otra empresa igual — no hay forma de escribirla mal.
--
-- Es la misma decisión que el §4.8 tomó para el dinero, y por la misma razón.
--
-- ─── LA POLÍTICA FALLA HACIA EL CIERRE ─────────────────────────────────────────────
--
-- Si el rol declarado es `cliente` y NO hay empresa declarada, no se ve nada. Es deliberado: una
-- sesión de cliente sin empresa es un error de programación, y el modo seguro de un error de
-- programación es no mostrar datos, nunca mostrarlos todos. El caso lo ejerce `suite-bd`.
--
-- Al revés, sin `app.current_role` declarado la política NO estorba: el operador, el chofer y el
-- dueño ven lo suyo como siempre. Lo que se confina es un rol concreto, no todo el que no se
-- identifique — eso habría dejado la app entera a ciegas hasta que cada consulta declarara quién
-- es, y una app a ciegas se arregla apagando la política.
--
-- ─── QUÉ SE CONFINA, Y CÓMO ────────────────────────────────────────────────────────
--
--   · `encargos` e `items` — por su propia columna `empresa_cliente_id`.
--   · `paradas` — por sus ítems: una parada es suya si lleva carga suya. Una parada agrupada de
--     tres empresas la ven las tres, cada una viendo SOLO sus ítems adentro (§3.E1.5).
--   · `rutas` — CERO filas. El §3.E1.10 dice que el contratante jamás ve rutas completas: saber
--     por qué otras doce puertas pasa el camión que le lleva el pan es información del negocio
--     del transportista, no suya.

-- ─── LO QUE YA ESTABA, Y POR ESO NO SE REPITE ─────────────────────────────────────
--
-- `usuarios.empresa_cliente_id` y su CHECK `usuarios_cliente_con_empresa` nacieron con el módulo
-- 01 (migración 0011): el §4.3 fija el mapeo «contratante = `cliente` con su empresa SIEMPRE» y
-- aquella migración lo escribió el día que creó la tabla, dejando anotado que la FK compuesta la
-- agregaría el módulo que creara `empresas_cliente`. Ese módulo es éste.

alter table usuarios drop constraint if exists usuarios_empresa_cliente_fk;
alter table usuarios add constraint usuarios_empresa_cliente_fk
  foreign key (tenant_id, empresa_cliente_id) references empresas_cliente (tenant_id, id);

-- El índice que la FK necesita: sin él, apagar una empresa escanearía la tabla de usuarios
-- entera (§9.2).
create index if not exists usuarios_tenant_empresa_idx on usuarios (tenant_id, empresa_cliente_id);

/**
 * Confina al rol `cliente` a las filas de SU empresa.
 *
 * RESTRICTIVE y FOR ALL: no alcanza con esconder las lecturas. Un cliente que pudiera ESCRIBIR
 * sobre el encargo de otra empresa no filtraría datos, haría algo peor — cambiaría la operación
 * de un tercero desde su propio portal.
 *
 * La comparación va por texto contra el GUC porque `current_setting` devuelve texto y un cast a
 * uuid sobre un valor mal formado rebota con 22P02 en vez de devolver cero filas: un error de
 * sesión no puede convertirse en un 500 que distingue «existe» de «no existe».
 */
create or replace function aplicar_rls_de_empresa(tabla regclass) returns void
  language plpgsql as $$
  begin
    execute format('alter table %s enable row level security', tabla);
    execute format(
      'create policy empresa_base on %s as permissive for all using (true) with check (true)',
      tabla);
    execute format(
      $politica$
      create policy empresa_del_cliente on %s
        as restrictive
        for all
        using (
          nullif(current_setting('app.current_role', true), '') is distinct from 'cliente'
          or empresa_cliente_id::text
             = nullif(current_setting('app.current_empresa', true), '')
        )
        with check (
          nullif(current_setting('app.current_role', true), '') is distinct from 'cliente'
          or empresa_cliente_id::text
             = nullif(current_setting('app.current_empresa', true), '')
        )
      $politica$, tabla);
  end
  $$;

comment on function aplicar_rls_de_empresa(regclass) is
  'Confina el rol `cliente` a su `empresa_cliente_id` (§7.2, §9.3.3). RESTRICTIVE FOR ALL: un '
  'cliente que pudiera escribir sobre el encargo de otra empresa cambiaría su operación.';

select aplicar_rls_de_empresa('encargos');
select aplicar_rls_de_empresa('items');

-- `usuarios` también, y no es un extra: un contratante que pudiera listar los usuarios del
-- tenant vería los nombres del personal del transportista y de las OTRAS empresas contratantes.
-- Su propia fila la sigue viendo —lleva su empresa—, y la resolución de sesión no se ve afectada
-- porque corre sin rol declarado, que es cuando la política no estorba.
select aplicar_rls_de_empresa('usuarios');

-- `paradas` no tiene la columna: se confina por sus ítems. Una parada agrupada de tres empresas
-- la ven las tres —cada una es dueña de su pedazo— y cada una ve SOLO sus ítems adentro, porque
-- de eso se encarga la política de `items`.
alter table paradas enable row level security;
create policy empresa_base on paradas as permissive for all using (true) with check (true);
create policy empresa_del_cliente on paradas
  as restrictive
  for all
  using (
    nullif(current_setting('app.current_role', true), '') is distinct from 'cliente'
    or exists (
      select 1 from items i
       where i.parada_id = paradas.id
         and i.empresa_cliente_id::text
             = nullif(current_setting('app.current_empresa', true), '')
    )
  );

-- `rutas`: CERO filas para el contratante. El §3.E1.10 dice que jamás ve rutas completas — por
-- qué otras doce puertas pasa el camión que le lleva el pan es información del negocio del
-- transportista, no suya.
alter table rutas enable row level security;
create policy empresa_base on rutas as permissive for all using (true) with check (true);
create policy sin_rutas_para_el_cliente on rutas
  as restrictive
  for all
  using (nullif(current_setting('app.current_role', true), '') is distinct from 'cliente');

comment on table rutas is
  'PLANIFICACIÓN — el día de un vehículo (§4.5, §5.2 F1). Se arma con red y antes de que el '
  'camión exista: acá SÍ se rebota 422 con 0 filas (§4.2). El rol `cliente` no ve ninguna '
  '(§3.E1.10): la ruta completa es información del negocio del transportista.';
