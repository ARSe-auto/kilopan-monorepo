import type { PoolClient } from "pg";
import { poolDe } from "./conexion.ts";
import { enActo, tenantIdEnControl } from "./gobierno.ts";
import type { Acto } from "./gobierno.ts";

// La pantalla «Funciones» del panel admin [AC-FMIG-08] — §5.5, §5.4.
//
// ─── EL VERBO ES «ALTERNAR», NO «ENCENDER» ────────────────────────────────────────────
//
// El §5.5 fija QUIÉN mueve el toggle sin matices: `admin_tenant` APAGA cualquier feature
// (override OFF siempre permitido) y ENCIENDE solo las incluidas en su plan (ON fuera de
// plan = locked-state con upsell, jamás un 200 disfrazado). La regla es asimétrica a
// propósito — apagar nunca puede romper nada que el dueño no haya elegido romper; encender
// SÍ puede prender algo que no pagó — y por eso el rebote de "fuera de plan" está en la
// función y no solo en la pantalla: una mutación DIRECTA por API, sin pasar por el botón,
// tiene que topar la misma pared (§4.2, PLANIFICACIÓN).
//
// ─── DOS BASES, UN ACTO (mismo patrón que `modo.ts`) ──────────────────────────────────
//
// `tenant_feature_overrides` vive en `control` (autoridad, §4.4); `audit_trail` y
// `config_version` viven en la base del TENANT. No hay transacción que abarque las dos, así
// que el orden es: escribir la autoridad en `control` primero, sellar el efecto en el tenant
// después, y si el sellado falla, deshacer `control` — el mismo criterio de `conmutarModo`.
//
// `audit_trail` normalmente lo llena el trigger `auditar()` (§4.6) enganchado tabla por
// tabla en la base que muta. Acá no hay trigger posible: la tabla que muta
// (`tenant_feature_overrides`) vive en OTRA base que la que audita. Por eso esta función
// inserta la fila de `audit_trail` a mano, con la misma forma que el trigger habría escrito
// (tabla, registro, operación, antes, después) — es la única manera de que el AC "cada
// toggle escribe audit_trail" sea cierto para una tabla cross-database.
//
// ─── "APLICA EN EL PRÓXIMO BOOTSTRAP" ES SELLAR UNA CONFIG_VERSION ────────────────────
//
// `servidor/config.ts` ya lo documenta: el runtime NUNCA vuelve a consultar `control`, así
// que un override que no sella versión nueva no cambia nada para nadie. Selllar acá es
// EXACTAMENTE lo que `e2e/documentos.spec.ts` hace a mano en su fixture (`sellarVersion`) —
// esta función es esa misma secuencia, ahora en producción.

export type Funcion = {
  lookupKey: string;
  module: string;
  habilitada: boolean;
  enPlan: boolean;
  porOverride: boolean;
  motivo: string | null;
};

/** Las features del catálogo con su estado efectivo para ESTE tenant, para pintar la
 *  pantalla: encendida/apagada, si viene del plan o de un override, y si un ON quedaría
 *  bloqueado por no estar en el plan. */
export async function listarFunciones(slug: string): Promise<Funcion[]> {
  const tenantId = await tenantIdEnControl(slug);
  const { rows } = await poolDe("control").query<{
    lookup_key: string;
    module: string;
    en_plan: boolean;
    habilitada: boolean;
    por_override: boolean;
    motivo: string | null;
  }>(
    `select f.lookup_key, f.module,
            (pf.feature_id is not null) as en_plan,
            ee.habilitada, ee.por_override, ee.motivo
       from features f
       cross join tenants t
       left join plan_features pf on pf.plan_id = t.plan_id and pf.feature_id = f.id
       left join entitlements_efectivos ee on ee.tenant_id = t.id and ee.lookup_key = f.lookup_key
      where t.id = $1
      order by f.module, f.lookup_key`,
    [tenantId],
  );
  return rows.map((r) => ({
    lookupKey: r.lookup_key,
    module: r.module,
    habilitada: r.habilitada,
    enPlan: r.en_plan,
    porOverride: r.por_override,
    motivo: r.motivo,
  }));
}

export type ResultadoToggle =
  | { tipo: "ok"; habilitada: boolean }
  | { tipo: "feature_desconocida" }
  | { tipo: "fuera_de_plan" };

/** Congela una `config_version` nueva con los entitlements efectivos DE AHORA — la misma
 *  secuencia que `servidor/config.ts` usa para la primera versión y que
 *  `e2e/documentos.spec.ts` deja documentada como "lo que la pantalla Funciones va a hacer". */
async function sellarEntitlements(c: PoolClient, tenantId: string, motivo: string): Promise<void> {
  const { rows } = await poolDe("control").query<{ lookup_key: string; habilitada: boolean }>(
    "select lookup_key, habilitada from entitlements_efectivos where tenant_id = $1",
    [tenantId],
  );
  const entitlements = Object.fromEntries(rows.map((f) => [f.lookup_key, f.habilitada]));
  await c.query("select crear_config_version($1, $2::jsonb)", [motivo, JSON.stringify(entitlements)]);
}

/**
 * Mueve el override de UNA feature. `enabled=false` (apagar) SIEMPRE se deja escribir — es
 * la mitad sin condición del §5.5. `enabled=true` (encender) exige que la feature esté en el
 * plan del tenant; si no, `fuera_de_plan` y CERO escritura, en `control` y en el tenant.
 */
export async function alternarFuncion(
  acto: Acto,
  lookupKey: string,
  enabled: boolean,
): Promise<ResultadoToggle> {
  const control = poolDe("control");
  const tenantId = await tenantIdEnControl(acto.slug);

  const { rows: featureRows } = await control.query<{ id: string }>(
    "select id::text as id from features where lookup_key = $1",
    [lookupKey],
  );
  const featureId = featureRows[0]?.id;
  if (!featureId) return { tipo: "feature_desconocida" };

  if (enabled) {
    const { rows: plan } = await control.query<{ en_plan: boolean }>(
      `select exists (
         select 1 from tenants t join plan_features pf on pf.plan_id = t.plan_id
          where t.id = $1 and pf.feature_id = $2
       ) as en_plan`,
      [tenantId, featureId],
    );
    // Fuera de plan: ni una fila se toca, ni en `control` ni en el tenant (§4.2). El
    // entitlement efectivo sigue siendo `override ?? plan`, y sin override el plan gana.
    if (!plan[0]?.en_plan) return { tipo: "fuera_de_plan" };
  }

  const { rows: actualRows } = await control.query<{ enabled: boolean }>(
    "select enabled from tenant_feature_overrides where tenant_id = $1 and feature_id = $2",
    [tenantId, featureId],
  );
  const anterior = actualRows[0]?.enabled ?? null;

  const motivo = `admin_tenant ${enabled ? "encendió" : "apagó"} «${lookupKey}» desde Funciones`;
  await control.query(
    `insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, feature_id) do update set enabled = excluded.enabled, motivo = excluded.motivo`,
    [tenantId, featureId, enabled, motivo],
  );

  try {
    await enActo(
      acto.pool,
      async (c) => {
        await sellarEntitlements(c, tenantId, `toggle de «${lookupKey}» desde Funciones`);
        await c.query(
          `insert into audit_trail (tabla, registro_id, operacion, actor_id, antes, despues)
           values ($1, $2::uuid, $3, $4, $5::jsonb, $6::jsonb)`,
          [
            "tenant_feature_overrides",
            featureId,
            anterior === null ? "INSERT" : "UPDATE",
            acto.sesion.usuarioId,
            anterior === null ? null : JSON.stringify({ enabled: anterior }),
            JSON.stringify({ enabled }),
          ],
        );
      },
      acto.sesion,
    );
  } catch (error) {
    // El sellado no quedó escrito: se devuelve `control` a donde estaba, que es el único
    // estado desde el que reintentar es seguro (mismo criterio que `conmutarModo`).
    if (anterior === null) {
      await control.query(
        "delete from tenant_feature_overrides where tenant_id = $1 and feature_id = $2",
        [tenantId, featureId],
      );
    } else {
      await control.query(
        "update tenant_feature_overrides set enabled = $3 where tenant_id = $1 and feature_id = $2",
        [tenantId, featureId, anterior],
      );
    }
    throw error;
  }

  return { tipo: "ok", habilitada: enabled };
}
