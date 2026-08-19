-- pgTAP: el seed del Anexo B llega vivo a un tenant PROVISIONADO. [AC-FSEM-03]
--
-- El AC pide, con estas palabras, que «tenant provisionado desde `tenant_template` nace con los
-- 6 dominios tenant poblados» y que ninguna fila referencie frío/humedad ni exista la fila
-- «webhook pactado caído» en E1. Esta suite corre contra `t_canary` (§4.1 LEEME.md: un tenant de
-- verdad, provisionado desde la plantilla igual que cualquier cliente) — así que si la migración
-- 0059 no llegó a la plantilla, esta suite lo ve fallar acá y no en producción.
--
-- El UPDATE de umbral por el tenant (§2.5, «sin deploy») y su rastro en `audit_trail` ya los
-- ejerce el pgTAP 0023 en general; acá se ejercen sobre una fila REAL del seed, para probar que
-- la vía de edición que describe el AC funciona con datos de verdad y no solo con un fixture de
-- prueba armado a mano.

select no_plan();

-- ─── Los 6 dominios, ni uno menos ────────────────────────────────────────────────────

select is(
  (select count(distinct dominio)::int from signal_rule),
  6,
  'el tenant provisionado desde la plantilla nace con los 6 dominios tenant del Anexo B poblados'
);

select bag_eq(
  $$ select dominio from signal_rule $$,
  $$ values ('entregas_vs_plan'), ('turnos_conductores'), ('flota_energia_ev'),
            ('datos_sync'), ('caja_custodia_liquidacion'), ('daas_sla') $$,
  'los 6 dominios son exactamente los del Anexo B — ninguno de más, ninguno de menos'
);

-- ─── Playbook accionable en cada fila: «toda señal es accionable o no existe» (§5.6) ─

select is(
  (select count(*)::int from signal_rule where btrim(playbook) = ''),
  0,
  'ninguna fila del seed tiene playbook vacío'
);

-- ─── La histéresis del seed es real, no solo posible ─────────────────────────────────

select is(
  (select count(*)::int from signal_rule
    where umbral_recuperacion = umbral_amarillo or umbral_recuperacion = umbral_rojo),
  0,
  'cada fila del seed trae una banda de recuperación de verdad, distinta de sus dos disparos'
);

-- ─── Cero frío/farma y cero webhook pactado caído, en el texto Y en el código ────────

select is(
  (select count(*)::int from signal_rule
    where dominio || ' ' || codigo || ' ' || playbook ~* 'temperatura|humedad|frio|frío'),
  0,
  'el seed E1 no siembra ninguna señal de frío/humedad — thermal_profile/alarm_rule siguen DDL-only (§4.9)'
);

select is(
  (select count(*)::int from signal_rule where codigo ~* 'webhook'),
  0,
  'el seed E1 no siembra «webhook pactado caído» — esa fila es de Plano B y además E2 (§3)'
);

-- ─── La vía real: el tenant edita el umbral de una fila SEMBRADA, sin deploy ─────────

select lives_ok(
  $$ update signal_rule set umbral_amarillo = 6 where codigo = 'no_entregas_pct_ruta' $$,
  'el tenant ajusta el umbral de una señal sembrada sin ninguna migración de por medio'
);

select isnt_empty(
  $$ select 1 from audit_trail
      where tabla = 'signal_rule'
        and despues ->> 'codigo' = 'no_entregas_pct_ruta'
        and (despues ->> 'umbral_amarillo')::numeric = 6 $$,
  'la edición del umbral sembrado queda en audit_trail, con el valor nuevo adentro'
);

select finish();
