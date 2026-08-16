-- pgTAP: el folio de la liquidación y el dinero invisible. [AC-FTAR-16] [AC-FTAR-17]
--
-- Las dos mitades que solo pueden vivir en la BASE: el vínculo liquidación→DTE con su unicidad
-- (0072) y la RLS de dinero sobre las tablas de monto del módulo (0073). Lo que el servicio
-- decide —rebotar 422 sobre una liquidación abierta— se prueba en su suite; acá se prueba lo
-- que ninguna cantidad de código de aplicación puede garantizar.

select no_plan();

-- ─── AC-FTAR-16 · el vínculo existe y es del MISMO tenant ───────────────────────────────

select has_column('liquidaciones', 'reference_document_id',
  'liquidaciones apunta al DTE que la ampara');

select col_is_null('liquidaciones', 'reference_document_id',
  'la columna es NULL mientras la liquidación está abierta: el folio llega recién al cerrar');

-- La FK es COMPUESTA por la regla de oro del §4.2: sin `tenant_id` adentro, una liquidación
-- podría apuntar al documento de otro tenant si un id se filtrara entre bases.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'liquidaciones'::regclass
      and contype = 'f'
      and confrelid = 'reference_document'::regclass
      and array_length(conkey, 1) = 2),
  1,
  'la FK hacia reference_document es compuesta (tenant_id, id), no simple por id'
);

-- ─── AC-FTAR-16 · un mismo DTE no puede amparar DOS liquidaciones ───────────────────────
--
-- Es la mitad de «duplicado ⇒ 422 y 0 filas» que NO puede vivir en el servicio: dos peticiones
-- simultáneas pasarían las dos por cualquier chequeo previo en código y solo el índice las
-- separa.

select has_index('liquidaciones', 'liquidaciones_documento_unico_idx',
  'existe el índice que impide que un DTE ampare dos liquidaciones');

-- ─── AC-FTAR-17 · las cuatro tablas de monto llevan el patrón del §4.8 ──────────────────

select is(
  (select count(*)::int from pg_class
    where relname in ('tarifas', 'tarifa_zonas', 'tarifa_recargo_horario', 'liquidacion_lineas')
      and relrowsecurity),
  4,
  'las cuatro tablas de monto del módulo tienen RLS encendida'
);

-- Las DOS políticas del patrón, no solo una: la permisiva de base y la restrictiva que saca al
-- chofer. Con la primera sola, el dinero se vería igual.
select is(
  (select count(*)::int from pg_policies
    where tablename in ('tarifas', 'tarifa_zonas', 'tarifa_recargo_horario', 'liquidacion_lineas')
      and policyname in ('dinero_base', 'dinero_sin_chofer')),
  8,
  'cada tabla de monto trae las DOS políticas del patrón (base permisiva + restrictiva)'
);

-- ─── AC-FTAR-17 · la vista operativa no esconde el dinero: no lo tiene ──────────────────
--
-- `parametros` mezcla plata con la configuración del terreno, así que el patrón de RLS la
-- dejaría ciega. La vista resuelve por estructura: el chofer lee de acá y el dinero
-- directamente no está.

select has_view('parametros_operativos',
  'existe la vista con la configuración operativa de parametros');

select hasnt_column('parametros_operativos', 'tarifa_kwh_clp',
  'la vista operativa no trae la tarifa de kWh');

select hasnt_column('parametros_operativos', 'precio_diesel_litro_clp',
  'la vista operativa no trae el precio del diésel');

-- Y sí trae lo que el terreno necesita: sin esto, la vista sería segura y también inútil, y el
-- chofer se quedaría sin la fórmula de energía del §0.
select has_column('parametros_operativos', 'reserva_pct',
  'la vista conserva la reserva: el chofer la necesita para la fórmula de energía');
select has_column('parametros_operativos', 'factor_consumo',
  'la vista conserva el factor de consumo');
select has_column('parametros_operativos', 'bultos_max_sin_receptor',
  'la vista conserva el tope de bultos sin receptor');

select * from finish();
