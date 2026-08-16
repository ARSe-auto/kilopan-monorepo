-- 0067 — Las vistas de liquidación que el rol `cliente` consume, y por qué NO reemplazan la
-- RLS de la tabla base. [AC-FPOR-05]
--
-- Fuente: §4.1 (rol `cliente` confinado a su empresa) · §4.3 («ve SOLO su liquidación vía
-- vistas») · §9.3.3 (centinela 3: sesión `cliente` de la empresa X ⇒ 0 filas de la empresa Y en
-- toda tabla operativa) · specs/flota/07-portal-contratante-daas.md §2 («confinado a su
-- empresa por política en BD + vistas … ve SOLO su liquidación vía vistas»).
--
-- ─── LO QUE YA ESTABA, Y EL HUECO QUE CERRABA FALTA ─────────────────────────────────────────
--
-- El CHECK `usuarios_cliente_con_empresa` (0011) y la RLS de `aplicar_rls_de_empresa` (0040)
-- YA confinan al rol `cliente` en `encargos`, `items`, `usuarios`, `paradas`, `rutas` (0040),
-- `tarifas`/`tarifa_zonas`/`tarifa_recargo_horario` (0061) y `liquidaciones`/`liquidacion_lineas`
-- (0063). `db/flota/suite-bd/confinamiento.test.mjs` ya prueba, con el rol de app REAL, que
-- TODA tabla con `empresa_cliente_id` lleva su política restrictiva — un invariante dinámico
-- que se pondría rojo si una tabla nueva llegara sin confinar. Lo que faltaba de este AC son
-- las VISTAS que el §4.3 nombra: la superficie que el portal (módulo 08, y el drill-down de
-- AC-FPOR-10) va a consultar en vez de tocar `liquidaciones`/`liquidacion_lineas` a mano.
--
-- ─── POR QUÉ LA VISTA NO PUEDE «BLOQUEAR LA TABLA Y ABRIR SOLO LA VISTA» ────────────────────
--
-- El §4.1 usa UN rol de conexión por tenant (`app_t_<slug>`, `db/flota/rol-app.mjs`) para
-- operador, chofer y cliente por igual; quién es cada sesión lo dice `app.current_role` con
-- `set_config(..., true)` (0040), no un rol de Postgres distinto. Con un solo rol de conexión,
-- un REVOKE de tabla se lo llevaría puesto TODOS los roles de la app, no solo `cliente` — y
-- security_invoker=true (obligatorio para TODA vista desde AC-FVEH-13, 0035, con su propio
-- invariante dinámico en pgtap/0016) hace que la vista corra con los privilegios Y la RLS de
-- quien la consulta: pedirle a la vista que vea lo que la tabla le niega a la misma sesión
-- reabriría exactamente el agujero que AC-FVEH-13 cerró (`energia_semanal` sumando filas que
-- la RLS le negaba al chofer). Blindar «solo vía vistas» con una vista que NO sea
-- security_invoker sería la fuga inversa: el chofer o el cliente de otra empresa lo verían entero.
--
-- La garantía de aislamiento sigue siendo, y solo puede ser, la RLS de la tabla base — la
-- vista aporta la SUPERFICIE (columnas y forma) que el §4.3 pide como la vía sancionada; la
-- convención de que el servidor del portal solo dispare SELECT contra estas vistas (jamás
-- contra `liquidaciones`/`liquidacion_lineas` en crudo) es de la capa de app, y ese candado con
-- oráculo HTTP es AC-FPOR-06/AC-FPOR-10, todavía no construidos.
--
-- ─── QUÉ COLUMNAS QUEDAN AFUERA, Y POR QUÉ ──────────────────────────────────────────────────
--
-- `tenant_id` no aporta nada fuera de la BD del propio tenant (una BD por tenant, §4.1) y
-- `disputa_client_uuid` es la llave de idempotencia interna de `disputar_linea()` (0066): un
-- detalle de implementación, no un dato de negocio del cliente.

create view liquidacion_cliente as
  select id, empresa_cliente_id, periodo_inicio, periodo_fin, estado, creado_en
    from liquidaciones;

alter view liquidacion_cliente set (security_invoker = true);

comment on view liquidacion_cliente is
  'La vía sancionada por la que el portal del contratante lee liquidaciones (§4.3, AC-FPOR-05). '
  'security_invoker=true: la RLS de `liquidaciones` (0063) sigue siendo quien confina — esta '
  'vista NO agrega aislamiento propio, solo la forma que el §4.3 pide.';

create view liquidacion_lineas_cliente as
  select
    id, liquidacion_id, empresa_cliente_id, evidencia_tipo, evidencia_id, concepto, tarifa_id,
    cantidad, precio_base_clp, modificadores_clp, monto_clp,
    disputa_estado, disputa_motivo_id, disputa_nota, disputa_creado_en, creado_en
    from liquidacion_lineas;

alter view liquidacion_lineas_cliente set (security_invoker = true);

comment on view liquidacion_lineas_cliente is
  'La vía sancionada por la que el portal del contratante lee líneas de liquidación (§4.3, '
  'AC-FPOR-05). security_invoker=true: la RLS de `liquidacion_lineas` (0063) sigue siendo quien '
  'confina. El join línea→evidencia del drill-down (§3.E1.9) queda para AC-FPOR-10.';
