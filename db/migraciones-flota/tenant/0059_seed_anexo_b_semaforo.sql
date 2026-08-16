-- 0059 — Seed del Anexo B en `signal_rule`: la taxonomía completa, no una tabla vacía. [AC-FSEM-03]
-- Spec 05 §2.5 · Fuente: §5.6-mecánica, Anexo B, §4.1 («vertical = INSERT»), §4.9 (ganchos DDL-only).
--
-- El §2.5 lo dice con estas palabras: «un tenant nuevo nace con la taxonomía completa». Esta
-- migración corre en `tenant/` — se aplica a `tenant_template` y a cada `t_<slug>` existente
-- (LEEME.md) — así que sembrar acá es sembrar la PLANTILLA: todo tenant provisionado desde hoy
-- nace con sus 6 dominios poblados sin que nadie escriba una fila a mano.
--
-- Un tenant YA existente no pierde nada por reaplicarla dos veces por error: `unique (tenant_id,
-- codigo)` la rebotaría con 23505, la misma protección que evita que el runner de `migrar.mjs`
-- la corra fuera de orden sin que alguien lo note.
--
-- ─── UNA FILA POR DOMINIO, NO LA TAXONOMÍA ENTERA ────────────────────────────────────
--
-- El Anexo B lista varias condiciones por dominio (p. ej. Entregas vs plan trae ETA-vivo Y
-- porcentaje de no-entregas). Esta siembra pobla, por dominio, LA condición mejor especificada
-- —la que no depende de una pregunta al dueño todavía abierta—: así el tenant nace con algo
-- editable y accionable hoy, y ninguna fila hornea una semántica que el maestro no fijó.
--
--   · `entregas_vs_plan`: el % de no-entregas de la ruta, banda literal del Anexo B (5–10%
--     amarillo, >10% rojo). La señal de ETA vivo queda fuera — depende de la pregunta 4.
--   · `turnos_conductores`: minutos sin evento del turno (30 min amarillo, 2 h rojo — el Anexo
--     B da el rojo en horas y el amarillo en minutos; se homogeniza a minutos, la UNIDAD no es
--     una decisión del maestro).
--   · `flota_energia_ev`: el margen de SOC en puntos porcentuales sobre la reserva — el propio
--     Anexo B da el número del amarillo («reserva + 5 pp») y el cruce a rojo es el mismo margen
--     llegando a cero («SOC actual < consumo estimado»). «Retorno proyectado <15%» y «no quedó
--     enchufado a la hora límite» son señales ADICIONALES de este dominio, no sembradas acá:
--     dependen de la proyección del módulo EV y del parámetro de hora límite (pregunta 5c) que
--     ese módulo todavía no expone.
--   · `datos_sync`: la edad máxima del outbox en minutos.
--   · `caja_custodia_liquidacion`: cantidad de discrepancias de custodia pendientes por cerrar
--     — cuenta, no un booleano, para que la histéresis tenga banda. La semántica de
--     «liquidación observada» queda fuera: pregunta 11 de la spec 06 la define.
--   · `daas_sla`: el déficit en puntos porcentuales del OTD contra el comprometido; el rojo usa
--     el mismo número que ya fija el fixture de AC-FSEM-18 (comprometido 95, período cerrado en
--     90 ⇒ déficit 5), para no inventar un segundo valor que ese AC tendría que reconciliar.
--
-- Ninguna fila referencia temperatura/humedad (`thermal_profile`/`alarm_rule` siguen DDL-only,
-- §4.9) ni existe una fila «webhook pactado caído»: esa señal es de Plano B (`control`, §3) y
-- además E2 — no se siembra en E1 en ningún plano. El pgTAP 0024 ejerce las dos ausencias.
--
-- ─── POR QUÉ EL SEED SE ESCRIBE CON EL TRIGGER DE AUDITORÍA APAGADO ──────────────────
--
-- `signal_rule` audita cada INSERT/UPDATE/DELETE en `audit_trail` (0058, §2.4) — correcto para
-- la EDICIÓN de un tenant real, que es lo que el AC pide dejar rastreado. Pero esta migración
-- corre sobre `tenant_template`, donde `tenant_actual()` resuelve al UUID centinela de la
-- plantilla (LEEME.md), y `db/flota/provisionar.mjs` adopta cada tabla con `tenant_id` hacia el
-- tenant nuevo con un UPDATE (`ADOPCIÓN DE LO QUE VENÍA EN LA PLANTILLA»). `audit_trail` es
-- append-only (§7.4, `rechazar_mutacion_de_hecho`): un UPDATE sobre ella rebota SIEMPRE, así que
-- si el INSERT de este seed dejara filas en `audit_trail` con el tenant_id centinela, la
-- adopción de CUALQUIER tenant nuevo se rompería para siempre con «audit_trail es append-only:
-- UPDATE está prohibido» — se verificó el rebote real al provisionar `t_ruteo_activo` con el
-- trigger encendido, antes de este ajuste. El seed no es la edición de un tenant —nace con la
-- plantilla, nadie lo «hizo»—, así que apagar el trigger para estas 6 filas no pierde el rastro
-- que el AC pide: ese rastro empieza en la primera edición real, hecha por un tenant de verdad.
alter table signal_rule disable trigger signal_rule_auditada;

insert into signal_rule (dominio, codigo, umbral_amarillo, umbral_rojo, umbral_recuperacion, playbook)
values
  ('entregas_vs_plan', 'no_entregas_pct_ruta', 5, 10, 3,
   'Llamar al conductor de la ruta y confirmar el motivo de las no-entregas antes de cerrar el turno.'),
  ('turnos_conductores', 'sin_senal_minutos', 30, 120, 15,
   'Llamar al conductor: sin eventos desde hace rato, confirmar que el turno sigue en curso.'),
  ('flota_energia_ev', 'soc_margen_reserva_pp', 5, 0, 10,
   'Revisar el vehículo con margen de batería bajo la reserva y coordinar carga antes del próximo tramo.'),
  ('datos_sync', 'outbox_cola_edad_max_min', 30, 180, 15,
   'Revisar el dispositivo con la cola de sync más vieja y pedirle sincronizar cuanto antes.'),
  ('caja_custodia_liquidacion', 'discrepancias_custodia_pendientes', 1, 3, 0,
   'Revisar la discrepancia de custodia pendiente en el cierre de ruta y resolverla antes del próximo turno.'),
  ('daas_sla', 'otd_deficit_pp', 2, 5, 0,
   'Revisar el contrato con OTD bajo el comprometido y coordinar con el cliente antes del cierre del período.');

alter table signal_rule enable trigger signal_rule_auditada;
