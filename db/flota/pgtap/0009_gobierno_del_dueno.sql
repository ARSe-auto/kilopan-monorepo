-- pgTAP: lo que la BASE sostiene del plano de control del dueño. [AC-FIDN-12]
--
-- Acá va lo del CATÁLOGO: que la tabla del código puente exista con sus dos restricciones
-- cerradas, que el índice parcial de «uno vivo por usuario» esté declarado tal cual, y que el
-- catálogo de eventos de gobierno haya llegado a la plantilla completo. El comportamiento por
-- HTTP —403 con rol ajeno, 404 sin sesión, el evento dentro de la transacción— vive en
-- `apps/flota/e2e/gobierno.spec.ts`, que es donde se puede pedir de verdad.
--
-- POR QUÉ EL CATÁLOGO DE EVENTOS SE VERIFICA ACÁ Y NO SOLO EN EL E2E. El e2e ejerce los
-- códigos que usa; los que todavía no tienen pantalla —el de reanudar, por ejemplo— viajarían
-- sin nadie que note que faltan hasta el día que un acto de gobierno rebote en producción por
-- un tipo de evento inexistente. Contarlos contra la plantilla los cubre a todos.

select no_plan();

select has_table('codigos_puente');

select col_not_null(t, c)
  from unnest(array['codigos_puente']) as t,
       unnest(array['usuario_id', 'token_hash', 'emitido_por']) as c;

-- El único desenlace posible: usado O anulado, jamás los dos. Sin esto, una fila podría decir
-- a la vez que el PIN se cambió y que el código nunca sirvió.
select has_check('codigos_puente');
select col_has_check('codigos_puente', array['usado_en', 'anulado_en']);

-- «Uno vivo por usuario», y PARCIAL: los usados y los anulados se acumulan porque son la
-- historia de quién pidió qué. Un UNIQUE total impediría la segunda rotación de un operario.
select is(
  (select indexdef from pg_indexes where indexname = 'codigos_puente_uno_vivo_idx'),
  'CREATE UNIQUE INDEX codigos_puente_uno_vivo_idx ON public.codigos_puente '
  || 'USING btree (tenant_id, usuario_id) WHERE ((usado_en IS NULL) AND (anulado_en IS NULL))',
  'codigos_puente: índice único PARCIAL sobre los códigos vivos'
);

-- La clase de la regla de oro (§4.2). El panel valida online y rebota 422 tipado: nada de
-- este módulo es captura de terreno.
select matches(
  obj_description('codigos_puente'::regclass, 'pg_class'),
  '^PLANIFICACIÓN',
  'codigos_puente: declara su clase PLANIFICACIÓN (§4.2)'
);

-- El trigger de auditoría enganchado: toda acción de gobierno deja `audit_trail` (§3.E1.14).
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'codigos_puente'::regclass and not tgisinternal),
  1, 'codigos_puente: el trigger de auditoría está enganchado'
);

-- ─── El catálogo de eventos del plano de control, entero ─────────────────────────────

select is(
  (select array_agg(codigo order by codigo) from evento_tipo where codigo like 'gobierno.%'),
  array[
    'gobierno.dispositivo_revocado',
    -- Los documentos con vencimiento también son del panel del dueño (§5.4, «edición de
    -- capacidades/DOCUMENTOS») [AC-FVEH-03]. El orden es alfabético porque el `array_agg` de
    -- arriba ordena por código: escribirlos donde parecen ir cronológicamente pone rojo el
    -- test sin que falte ni sobre nada.
    'gobierno.documento_cargado',
    'gobierno.documento_eliminado',
    'gobierno.invitacion_emitida',
    'gobierno.invitacion_pausada',
    'gobierno.invitacion_reanudada',
    'gobierno.invitacion_revocada',
    -- El selector de modo (§3) cambia qué módulos ve la operación entera: es un acto del dueño
    -- y por eso vive en esta familia [AC-FRUT-14].
    'gobierno.modo_conmutado',
    'gobierno.pin_definido',
    'gobierno.puente_emitido',
    'gobierno.solicitud_aprobada',
    'gobierno.solicitud_rechazada',
    'gobierno.soporte_otorgado',
    'gobierno.soporte_revocado',
    'gobierno.usuario_desbloqueado',
    -- Los seis últimos llegaron con el módulo 02: el §5.4 pone «alta, edición de
    -- capacidades/DOCUMENTOS y desactivación de VEHÍCULOS» dentro del plano de control
    -- exclusivo del dueño, así que son de esta familia [AC-FVEH-01, 02 y 03].
    'gobierno.vehiculo_creado',
    'gobierno.vehiculo_desactivado',
    'gobierno.vehiculo_editado',
    'gobierno.vehiculo_reactivado'
  ],
  'catálogo de eventos de gobierno: los diecinueve actos, sin uno de menos'
);

-- Y cada uno con su descripción escrita: un catálogo de códigos sin texto es un panel de
-- auditoría que muestra identificadores y le pide al dueño que los traduzca.
select is(
  (select count(*)::int from evento_tipo
    where codigo like 'gobierno.%' and length(btrim(descripcion)) > 0),
  19, 'cada tipo de evento de gobierno trae su descripción en es-CL'
);

select finish();
