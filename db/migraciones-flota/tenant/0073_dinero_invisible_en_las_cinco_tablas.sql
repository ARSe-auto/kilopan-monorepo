-- 0073 — el dinero invisible, aplicado a las tablas de monto del módulo 06. [AC-FTAR-17]
--
-- El §4.8 dice que el chofer no VE montos pero su captura sigue funcionando, y la 0004 dejó el
-- patrón hecho función (`aplicar_rls_de_dinero`) para que aplicarlo sea una línea y no una
-- copia. Hasta acá lo llevaba solo `energy_entry`: las cinco tablas de plata del módulo de
-- tarifas quedaron fuera cuando se construyeron, que es justo el olvido que la función existe
-- para hacer barato de reparar.
--
-- CUATRO SON MECÁNICAS, LA QUINTA NO
-- -----------------------------------
-- `tarifas`, `tarifa_zonas`, `tarifa_recargo_horario` y `liquidacion_lineas` son tablas de
-- economía pura: el chofer no tiene nada que hacer con ellas y esconderlas ENTERAS es
-- exactamente lo que el §4.8 pide. Van con la función, sin pensar.
--
-- `parametros` es el caso que la spec marcó como «no mecánico», y con razón: en la misma fila
-- conviven `tarifa_kwh_clp` y `precio_diesel_litro_clp` —dinero— con `reserva_pct`,
-- `factor_consumo` y `bultos_max_sin_receptor`, que son la CONFIGURACIÓN con la que el terreno
-- opera. Aplicarle el patrón de RLS la escondería entera y dejaría al chofer sin la fórmula de
-- energía del §0: apagar el dinero le apagaría el trabajo.
--
-- Y `revoke select` por columna tampoco sirve acá, aunque la spec lo nombre como opción: el rol
-- de Postgres es UNO por tenant (`app_t_<slug>`, §4.1) y el papel del usuario viaja en
-- `app.current_role`, una variable de SESIÓN. Un `revoke` mira el rol, no la variable, así que
-- le quitaría la columna al gestor igual que al chofer.
--
-- La salida es una VISTA sin las dos columnas de plata. La tabla queda intacta —el gestor y el
-- servidor la leen como siempre— y el terreno consume la vista, que no tiene nada que esconder
-- porque el dinero directamente no está ahí. La regla se vuelve estructural en vez de
-- condicional, que es el mismo criterio del §7.8 con los identificadores.

select aplicar_rls_de_dinero('tarifas');
select aplicar_rls_de_dinero('tarifa_zonas');
select aplicar_rls_de_dinero('tarifa_recargo_horario');
select aplicar_rls_de_dinero('liquidacion_lineas');

-- `security_invoker` NO es opcional en este esquema (lo exige el pgTAP 0016 para TODA vista del
-- tenant): sin él la vista corre con los permisos de quien la creó —el migrador— y devolvería
-- filas que la RLS le niega a quien pregunta. Una vista que existe para acotar lo que se ve no
-- puede ser, ella misma, la puerta que lo abre.
create or replace view parametros_operativos with (security_invoker = true) as
  select id, tenant_id, unica, reserva_pct, factor_consumo, bultos_max_sin_receptor
    from parametros;

comment on view parametros_operativos is
  'La configuración de `parametros` SIN las dos columnas de dinero (tarifa_kwh_clp, '
  'precio_diesel_litro_clp) [AC-FTAR-17]. Existe porque el §4.8 pide que el chofer no vea '
  'montos y el §0 pide que SÍ vea la formula de energia: en `parametros` las dos cosas viven en '
  'la misma fila, asi que esconderla entera con RLS lo dejaria sin `reserva_pct` ni '
  '`factor_consumo`. Un `revoke` por columna tampoco sirve -- el rol de Postgres es uno por '
  'tenant y el papel del usuario viaja en `app.current_role`, que un GRANT no mira. El terreno '
  'lee esta vista; el dinero no esta escondido acá, simplemente no esta.';
