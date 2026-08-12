-- 0060 — Qué `signal_rule` evalúa, según la config CONGELADA del turno. [AC-FSEM-13]
-- Spec 05 §2.7 · Fuente: §5.5, §4.4 (config congelada, `crear_config_version`, AC-FTEN-13).
--
-- «Apagar el feature de liquidación ⇒ sus `signal_rule` dejan de evaluar en el próximo
-- bootstrap (el turno abierto termina con su config congelada, `turno.config_version_id`) y
-- no nacen excepciones nuevas de ese origen» (§2.7). Esta migración es la mitad de BD de esa
-- frase: NO borra ni toca una sola fila de `signal_rule` — eso es lo que exige el centinela
-- 11 (§9.3.11, mismo criterio que `modo_recorte`, control/0003) — sino que ofrece la LECTURA
-- que un evaluador futuro (AC-FSEM-16..19, todavía sin construir) tendría que usar en vez de
-- `select * from signal_rule` a secas.
--
-- ─── POR QUÉ CONTRA `config_version.snapshot`, JAMÁS CONTRA `control` EN CALIENTE ───
--
-- El §4.4 (Pregunta 4, respuesta del dueño) cierra que el runtime del producto nunca vuelve a
-- consultar `control` por entitlements: se congelan en el snapshot al sellar una versión
-- (`crear_config_version`, tenant/0009). Leer esta función con el `config_version_id` de un
-- turno ABIERTO devuelve exactamente lo que regía cuando ese turno arrancó, aunque alguien
-- haya apagado el feature un minuto después — «aplica en el próximo bootstrap» es LITERAL:
-- el próximo bootstrap sella una versión nueva: `apps/flota/src/servidor/config.ts` documenta
-- la misma regla para `entitlementVigente`.
--
-- ─── UN SOLO DOMINIO CON GATILLA EN E1 ──────────────────────────────────────────────
--
-- El Anexo B (spec 05 §2.5) es explícito: solo `caja_custodia_liquidacion` tiene una fila
-- «con liquidación OFF esas señales no evalúan». Los otros 5 dominios (incluida `daas_sla`,
-- que se contrae por su propia regla de NULL en `otd_comprometido_pct`, §4.5 — no por esto)
-- jamás se contraen por feature: por eso el CASE por defecto es `true`, no una tabla que
-- alguien tenga que poblar para que el resto del semáforo siga vivo.
create or replace function dominio_semaforo_activo(p_dominio text, p_config_version_id uuid)
  returns boolean
  language sql stable
  as $$
    select case p_dominio
      when 'caja_custodia_liquidacion' then coalesce(
        (select (snapshot -> 'entitlements' ->> 'liquidacion_por_cliente')::boolean
           from config_version
          where id = p_config_version_id and tenant_id = tenant_actual()),
        false)
      else true
    end
  $$;

comment on function dominio_semaforo_activo(text, uuid) is
  'Si el dominio evalúa según la config CONGELADA del turno (§2.7, §4.4) — no borra ni lee '
  '`signal_rule`, solo dice si un evaluador debería considerarlo. Config sin sellar o feature '
  'sin configurar cuenta como apagada, mismo criterio que `entitlementVigente` en TS '
  '(servidor/config.ts): encender por defecto algo que nadie decidió es el rebote equivocado.';

-- Las señales realmente activas para un turno: `signal_rule` filtrada por el gate de arriba,
-- SIN tocar la tabla — el filtro vive en la LECTURA, jamás en un DELETE (§2.7, centinela 11:
-- «no nacen excepciones nuevas de ese origen» se cumple porque un evaluador que respete esta
-- vista no tiene de dónde leer la fila apagada, no porque la fila haya desaparecido).
create or replace function signal_rule_activas(p_config_version_id uuid)
  returns setof signal_rule
  language sql stable
  as $$
    select sr.* from signal_rule sr
     where sr.tenant_id = tenant_actual()
       and dominio_semaforo_activo(sr.dominio, p_config_version_id)
  $$;

comment on function signal_rule_activas(uuid) is
  'Las filas de `signal_rule` que un evaluador debería considerar para un turno dado, según su '
  'config congelada (§2.7). La fila contraída sigue existiendo en `signal_rule` — esta función '
  'filtra la lectura, no el dato (centinela 11).';
