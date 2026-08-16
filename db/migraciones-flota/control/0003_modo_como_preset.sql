-- 0003 — El modo del tenant como PRESET del mismo sistema de entitlements (§3, §4.4). [AC-FTEN-22]
--
-- El §3 es explícito: los modos NO son código distinto, son presets del MISMO sistema de
-- entitlements. Por eso el recorte de `mi_flota` se aplica en la RESOLUCIÓN y no borrando
-- filas: conmutar es aditivo, jamás destructivo, y volver a `daas` tiene que devolver todo
-- exactamente como estaba sin restaurar nada (base del centinela 11).
--
-- Si el recorte se implementara borrando `plan_features` o apagando overrides, conmutar dos
-- veces perdería la configuración del tenant — y ese es justamente el caso que el centinela 11
-- existe para atrapar.

-- El mapeo CERRADO del §3, como filas y no como un `if` en el código: `mi_flota` deja lo
-- operativo puro y apaga las cuatro cosas del contratante. `daas` no recorta nada, y por eso
-- no tiene filas acá — la ausencia ES el mapeo.
create table modo_recorte (
  modo               tenant_modo not null,
  feature_lookup_key text        not null,
  primary key (modo, feature_lookup_key)
);
comment on table modo_recorte is
  'PLANIFICACIÓN — qué apaga cada modo. Mapeo CERRADO del §3: filas, no condicionales. La '
  'ausencia de filas para daas es el mapeo, no un olvido.';

insert into modo_recorte (modo, feature_lookup_key) values
  ('mi_flota', 'tarifas'),
  ('mi_flota', 'liquidacion_por_cliente'),
  ('mi_flota', 'portal_contratante'),
  ('mi_flota', 'facturacion');

-- La resolución, ahora con el preset encima. El orden es: recorte del modo → override → plan.
--
-- El recorte gana sobre el override A PROPÓSITO. El §3 dice «OFF y ocultos», sin matices: si
-- un override pudiera encender tarifas en un tenant `mi_flota`, el modo dejaría de significar
-- algo y la pantalla del contratante aparecería a medias. Encenderlas se hace conmutando el
-- modo, que es exactamente para lo que el modo existe — y como el recorte no borra nada,
-- conmutar las devuelve intactas.
create or replace function entitlement_efectivo(p_tenant uuid, p_feature text)
  returns boolean
  language sql stable
  as $$
    select case
      when exists (
        select 1 from tenants t
          join modo_recorte r on r.modo = t.modo and r.feature_lookup_key = p_feature
         where t.id = p_tenant)
      then false
      else coalesce(
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
    end
  $$;

comment on function entitlement_efectivo(uuid, text) is
  'La ÚNICA resolución de entitlements: recorte del modo → override → plan (§3, §4.4). El '
  'recorte gana sobre el override porque el §3 dice «OFF y ocultos», sin matices.';

-- `CREATE OR REPLACE VIEW` no admite renombrar ni reordenar columnas, y esta versión agrega
-- `recortada_por_modo` en el medio. Se rehace: la vista no tiene datos que perder.
drop view if exists entitlements_efectivos;

create view entitlements_efectivos as
  select t.id                                     as tenant_id,
         f.lookup_key,
         f.module,
         entitlement_efectivo(t.id, f.lookup_key) as habilitada,
         r.feature_lookup_key is not null         as recortada_por_modo,
         o.enabled is not null                    as por_override,
         o.motivo
    from tenants t
    cross join features f
    left join plan_features pf on pf.plan_id = t.plan_id and pf.feature_id = f.id
    left join tenant_feature_overrides o on o.tenant_id = t.id and o.feature_id = f.id
    left join modo_recorte r on r.modo = t.modo and r.feature_lookup_key = f.lookup_key;

comment on view entitlements_efectivos is
  'Entitlement efectivo de cada feature para cada tenant, diciendo si lo apagó el modo, si '
  'vino de un override y con qué motivo. Llama a la MISMA función: una sola fórmula.';
