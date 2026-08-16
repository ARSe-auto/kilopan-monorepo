-- 0002 — Resolución del entitlement efectivo (§4.4). [AC-FTEN-11]
--
-- La fórmula del maestro es LITERAL: `efectivo = override ?? plan`. Nada más. Una sola
-- función y una sola vista, para que ningún módulo la reimplemente con su propio matiz.
--
-- Lo que esta función NO hace, a propósito: impedir que se ENCIENDA una feature fuera del
-- plan. Un override ON sobre una feature que el plan no trae resuelve ON, porque eso es lo
-- que dice `override ?? plan`. El guard comercial que decide si ese override se puede crear
-- es regla de la pantalla «Funciones» del hito g (§5.5), no de la resolución: mezclarlos haría
-- imposible el caso legítimo de un piloto acordado con un cliente — y ese caso es justamente
-- por lo que `tenant_feature_overrides.motivo` es obligatorio.
--
-- El resultado se congela en el snapshot de config del tenant (Pregunta 4, 09-ago-2026), con
-- lo cual el runtime del producto nunca vuelve a consultar `control` por esto.

create or replace function entitlement_efectivo(p_tenant uuid, p_feature text)
  returns boolean
  language sql stable
  as $$
    select coalesce(
      (select o.enabled
         from tenant_feature_overrides o
         join features f on f.id = o.feature_id
        where o.tenant_id = p_tenant and f.lookup_key = p_feature),
      exists (
        select 1
          from tenants t
          join plan_features pf on pf.plan_id = t.plan_id
          join features f on f.id = pf.feature_id
         where t.id = p_tenant and f.lookup_key = p_feature)
    )
  $$;

comment on function entitlement_efectivo(uuid, text) is
  'La ÚNICA resolución de entitlements: override ?? plan (§4.4). Un override ON resuelve ON '
  'aunque el plan no traiga la feature; el guard de «no encender fuera de plan» es del hito g.';

-- La vista es la misma fórmula en forma de conjunto: sirve para armar el snapshot de config
-- de un tenant de una sola lectura, en vez de N llamadas a la función.
create or replace view entitlements_efectivos as
  select t.id                             as tenant_id,
         f.lookup_key,
         f.module,
         coalesce(o.enabled, pf.feature_id is not null) as habilitada,
         o.enabled is not null            as por_override,
         o.motivo
    from tenants t
    cross join features f
    left join plan_features pf on pf.plan_id = t.plan_id and pf.feature_id = f.id
    left join tenant_feature_overrides o on o.tenant_id = t.id and o.feature_id = f.id;

comment on view entitlements_efectivos is
  'Entitlement efectivo de cada feature para cada tenant, con si vino del plan o de un '
  'override y con qué motivo. Misma fórmula que entitlement_efectivo(), en forma de conjunto.';
