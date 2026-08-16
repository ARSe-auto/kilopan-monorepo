-- pgTAP: la histéresis de una señal la exige el ESQUEMA, no la pantalla. [AC-FSEM-02]
--
-- El AC pide, con estas palabras, «CHECK en `signal_rule` exige `umbral_recuperacion` distinto
-- del de disparo (INSERT con umbral igual ⇒ rebota)». Esta es esa mitad. La otra —la secuencia
-- disparo → zona intermedia (sigue) → recuperación (verde), y la misma mecánica para
-- rojo→amarillo— es lógica pura y vive en `apps/flota/src/dominio/semaforo-histeresis.test.ts`,
-- donde se ejerce paso a paso sin necesitar base.
--
-- Se prueba también el UPDATE y no solo el INSERT: los umbrales los edita el tenant sin deploy
-- (§2.5), así que la vía por la que en la práctica va a llegar una fila sin banda de histéresis
-- es un ajuste de umbral en el panel admin, no la siembra.

select no_plan();

select has_table('signal_rule');
select has_column('signal_rule', c)
  from unnest(array['dominio', 'codigo', 'umbral_amarillo', 'umbral_rojo',
                    'umbral_recuperacion', 'playbook']) as c;
-- Sin banda de recuperación no hay histéresis posible: la columna no admite el nulo, que sería
-- la forma silenciosa de quedarse sin ella.
select col_not_null('signal_rule', 'umbral_recuperacion');
select has_check('signal_rule');

-- ─── El positivo primero: sin él, un CHECK que rechazara cualquier fila pasaría igual ──

select lives_ok(
  $$ insert into signal_rule (dominio, codigo, umbral_amarillo, umbral_rojo,
                              umbral_recuperacion, playbook)
     values ('datos_sync', 'outbox_edad_max_min', 30, 60, 20,
             'Revisar el aparato con la cola más vieja y pedirle sincronizar') $$,
  'una señal con banda de histéresis (recuperación 20 bajo el disparo 30) entra'
);

-- ─── El disparo amarillo: recuperación igual ⇒ rebota ───────────────────────────────
--
-- Con 30 y 30 la señal cruza y descruza el mismo punto: en cada poll de la pestaña visible
-- nacería y moriría una excepción, y la cola «Por revisar» dejaría de significar algo.

select throws_ok(
  $$ insert into signal_rule (dominio, codigo, umbral_amarillo, umbral_rojo,
                              umbral_recuperacion, playbook)
     values ('datos_sync', 'sin_sync_horas', 30, 60, 30, 'Llamar al conductor') $$,
  '23514',
  null,
  'recuperación IGUAL al umbral de disparo amarillo rebota: sin banda no hay histéresis (§2.4)'
);

-- ─── El otro umbral de disparo es el rojo, y también cuenta ─────────────────────────

select throws_ok(
  $$ insert into signal_rule (dominio, codigo, umbral_amarillo, umbral_rojo,
                              umbral_recuperacion, playbook)
     values ('turnos_conductores', 'sin_senal_horas', 30, 60, 60, 'Llamar al conductor') $$,
  '23514',
  null,
  'recuperación igual al umbral de disparo ROJO rebota: el rojo quedaría oscilando (§2.4)'
);

-- ─── La vía real: el tenant editando su umbral sin deploy (§2.5) ────────────────────

select throws_ok(
  $$ update signal_rule set umbral_recuperacion = umbral_amarillo
      where codigo = 'outbox_edad_max_min' $$,
  '23514',
  null,
  'el UPDATE que borra la banda de histéresis rebota igual que el INSERT: el CHECK no distingue '
  'quién lo escribe (§2.4)'
);

-- Y la edición que sí conserva la banda pasa: el tenant ajusta sus umbrales sin deploy y lo
-- único que no puede hacer es dejarse sin histéresis.
select lives_ok(
  $$ update signal_rule set umbral_amarillo = 45, umbral_recuperacion = 25
      where codigo = 'outbox_edad_max_min' $$,
  'mover los umbrales conservando la banda sí aplica: la edición por tenant no está bloqueada'
);

-- La edición queda en `audit_trail` (§2.4, §4.6): sin eso, una señal que dejó de avisar no
-- tiene a quién preguntarle.
select isnt_empty(
  $$ select 1 from audit_trail where tabla = 'signal_rule' $$,
  'la edición de un umbral deja rastro en audit_trail'
);

select finish();
