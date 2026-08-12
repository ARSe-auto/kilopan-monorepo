-- pgTAP: contracción sin residuos del semáforo por feature. [AC-FSEM-13]
--
-- El AC pide, con estas palabras, que «apagar el feature de liquidación ⇒ sus `signal_rule`
-- dejan de evaluar en el próximo bootstrap (el turno abierto termina con su config congelada)
-- y no nacen excepciones nuevas de ese origen». Esta suite corre contra `t_canary` (mismo
-- criterio que 0023/0024) y ejerce las DOS mitades: que la fila de `signal_rule` de
-- `caja_custodia_liquidacion` (sembrada por 0059, AC-FSEM-03) sigue existiendo tal cual pase
-- lo que pase con el feature — CERO residuos — y que `signal_rule_activas()` deja de
-- devolverla cuando la config CONGELADA dice que liquidación está apagada, sin tocar la tabla.
--
-- Un test que solo mirara `signal_rule_activas()` pasaría en verde con una implementación que
-- BORRA la fila cuando el feature está OFF: por eso cada caso cuenta primero el total crudo de
-- `signal_rule` y recién después mira el filtro.

select no_plan();

-- ─── Punto de partida: la fila sembrada del dominio existe, cruda, antes de tocar nada ──────

select is(
  (select count(*)::int from signal_rule where dominio = 'caja_custodia_liquidacion'),
  1,
  'el tenant nace con 1 fila sembrada en caja_custodia_liquidacion (AC-FSEM-03) — punto de partida'
);

-- ─── Dos versiones congeladas, dos respuestas — «aplica en el próximo bootstrap» ────────────
--
-- v_on simula el turno que ya estaba abierto cuando liquidación se apagó: su config quedó
-- congelada ANTES del apagado y sigue viendo el dominio activo. v_off simula el bootstrap
-- siguiente, que ya sella con el feature OFF. Las dos versiones conviven — congelar la
-- segunda no altera ni borra la primera (append-only, AC-FTEN-13).

select lives_ok(
  $$ select crear_config_version('turno abierto — liquidación ON', '{"liquidacion_por_cliente": true}'::jsonb) $$,
  'se sella una versión con liquidación encendida (simula el turno que ya estaba corriendo)'
);

select lives_ok(
  $$ select crear_config_version('próximo bootstrap — liquidación OFF', '{"liquidacion_por_cliente": false}'::jsonb) $$,
  'se sella una versión nueva con liquidación apagada (simula el próximo bootstrap)'
);

select lives_ok(
  $$ select crear_config_version('bootstrap sin configurar', '{}'::jsonb) $$,
  'se sella una tercera versión que nunca menciona la feature (tenant que nunca la tocó)'
);

-- ─── Con la config ON, el dominio evalúa ────────────────────────────────────────────────────

select ok(
  (select dominio_semaforo_activo(
    'caja_custodia_liquidacion',
    (select id from config_version where motivo = 'turno abierto — liquidación ON')
  )),
  'con la config congelada en ON, el dominio caja_custodia_liquidacion evalúa'
);

select bag_eq(
  $$ select codigo from signal_rule_activas(
       (select id from config_version where motivo = 'turno abierto — liquidación ON')
     ) where dominio = 'caja_custodia_liquidacion' $$,
  $$ values ('discrepancias_custodia_pendientes') $$,
  'signal_rule_activas() con la versión ON trae la fila sembrada del dominio, viva'
);

-- ─── Con la config OFF, el dominio deja de evaluar — SIN TOCAR LA FILA (centinela 11) ──────

select ok(
  not (select dominio_semaforo_activo(
    'caja_custodia_liquidacion',
    (select id from config_version where motivo = 'próximo bootstrap — liquidación OFF')
  )),
  'con la config congelada en OFF, el dominio caja_custodia_liquidacion deja de evaluar'
);

select is_empty(
  $$ select 1 from signal_rule_activas(
       (select id from config_version where motivo = 'próximo bootstrap — liquidación OFF')
     ) where dominio = 'caja_custodia_liquidacion' $$,
  'signal_rule_activas() con la versión OFF NO trae ninguna fila de ese dominio — no evalúa'
);

select is(
  (select count(*)::int from signal_rule where dominio = 'caja_custodia_liquidacion'),
  1,
  'CERO RESIDUOS: la fila sembrada sigue en signal_rule tal cual, apagar el feature no la tocó'
);

-- ─── Sin configurar (tenant que nunca definió la feature) cuenta como apagada ───────────────
--
-- Mismo criterio que `entitlementVigente` en TS (servidor/config.ts): encender por defecto
-- algo que nadie decidió es el rebote equivocado, no la lectura segura.

select ok(
  not (select dominio_semaforo_activo(
    'caja_custodia_liquidacion',
    (select id from config_version where motivo = 'bootstrap sin configurar')
  )),
  'sin la feature en el snapshot, el dominio cuenta como apagado — no encendido por defecto'
);

-- ─── El turno abierto con la versión vieja NO cambia de opinión ────────────────────────────
--
-- Sellar la versión OFF (el «próximo bootstrap») no reescribe la versión ON: son dos filas
-- append-only distintas, y quien siga leyendo con `turno.config_version_id` = la vieja sigue
-- viendo exactamente lo que veía — «el turno abierto termina con su config congelada» (§2.7).

select ok(
  (select dominio_semaforo_activo(
    'caja_custodia_liquidacion',
    (select id from config_version where motivo = 'turno abierto — liquidación ON')
  )),
  'la versión ON sigue viva y activa después de sellar la versión OFF — congelada de verdad'
);

-- ─── Los otros 5 dominios jamás se contraen por esta feature ───────────────────────────────

select bag_eq(
  $$ select dominio from signal_rule_activas(
       (select id from config_version where motivo = 'próximo bootstrap — liquidación OFF')
     ) $$,
  $$ values ('entregas_vs_plan'), ('turnos_conductores'), ('flota_energia_ev'),
            ('datos_sync'), ('daas_sla') $$,
  'con liquidación OFF, los otros 5 dominios del Anexo B siguen evaluando — el recorte es acotado'
);

select finish();
