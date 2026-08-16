-- 0009 — Las cuatro features que el modo recorta, como filas de catálogo. [AC-FTAR-18]
--
-- La 0003 declaró el mapeo CERRADO del §3 —qué apaga `mi_flota`— en `modo_recorte`, y la
-- resolución del §4.4 lo aplica en el orden recorte → override → plan. Lo que faltó ahí es que
-- las cuatro `lookup_key` que ese mapeo nombra NUNCA se sembraron en `features`: el mapeo
-- apuntaba a un catálogo que no las tenía.
--
-- POR QUÉ ESO NO SE VE COMO UN ERROR HASTA QUE SE BUSCA
-- -----------------------------------------------------
-- `modo_recorte` no tiene FK contra `features` —son tablas del mismo plano de control pero el
-- recorte es por `lookup_key` de texto, no por id—, así que nada rebota. La resolución
-- simplemente no encuentra la feature, el snapshot congelado del tenant no la incluye para
-- NINGÚN modo, y el manifest la omite siempre: en `daas` se ve igual que en `mi_flota`. El
-- síntoma es una contracción que parece funcionar porque el resultado visible coincide con lo
-- esperado en la mitad de los casos.
--
-- Existen HOY en el cluster de desarrollo porque las suites las crean al vuelo con
-- `on conflict do update`; un cluster nacido de cero no las tendría. Esa es exactamente la
-- clase de defecto que solo aparece en la primera instalación real.
--
-- POR QUÉ `module = '00'` Y SIN PLAN QUE LAS TRAIGA
-- -------------------------------------------------
-- Mismo patrón que la 0006 y la 0008: una fila de catálogo, sin `plan_features` que la
-- encienda, y por lo tanto apagada para todos hasta que el hito (g) siembre los planes. El
-- módulo es '00' —el núcleo— y no '06', porque el grupo DaaS lo resuelve el sistema de
-- entitlements del núcleo (§4.4), no el módulo de tarifas: quien lo apaga es el MODO.

insert into features (lookup_key, module) values
  ('tarifas', '00'),
  ('liquidacion_por_cliente', '00'),
  ('portal_contratante', '00'),
  ('facturacion', '00')
  on conflict (lookup_key) do nothing;
