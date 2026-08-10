import type { PoolClient } from "pg";
import { poolDe } from "./conexion.ts";
import { tenantIdEnControl } from "./gobierno.ts";

// La configuración congelada del tenant, y los entitlements que viajan en ella [AC-FVEH-03].
//
// ─── EL RUNTIME NO CONSULTA `control` ───────────────────────────────────────────────
//
// El §4.4 lo cierra con la respuesta del dueño del 09-ago-2026 (Pregunta 4): el entitlement
// efectivo se congela en el snapshot de config del tenant, «con lo cual el runtime del producto
// nunca vuelve a consultar `control` por esto». No es una optimización: una consulta
// cross-database en caliente está prohibida por el §4.1 y el §7.2, y además haría que apagar
// una feature cambiara el comportamiento de un turno que ya estaba corriendo — justo lo que el
// §4.4 prohíbe con «un turno corre entero con UNA versión».
//
// Por eso acá se lee del snapshot y solo se toca `control` cuando el tenant todavía no tiene
// ninguna versión sellada, que es una vez en la vida de la base.
//
// ─── CUÁNDO CAMBIA UN TOGGLE ────────────────────────────────────────────────────────
//
// Al SELLARSE una versión nueva, no al crearse el override. Es la conducta del §5.5 —«cada
// toggle escribe audit_trail y aplica en el próximo bootstrap; los turnos abiertos terminan
// con su config congelada»— y quien sella desde la pantalla «Funciones» es el hito (g). Este
// módulo no adelanta esa pantalla: se limita a leer lo que hay sellado.

/** Los entitlements tal como quedaron congelados: `lookup_key` → encendido. */
export type Entitlements = Record<string, boolean>;

/**
 * La versión vigente de la configuración, sellando la primera si el tenant no tiene ninguna.
 *
 * `slug` es el del RUTEO —lo sobrescribe `servidor.mjs` con el veredicto de `control`, jamás
 * llega del cliente— y de ahí sale el id con el que se leen los entitlements del plano de
 * control.
 */
export async function versionVigente(c: PoolClient, slug: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "select id::text as id from config_version order by id desc limit 1",
  );
  if (rows[0]) return rows[0].id;

  const tenantId = await tenantIdEnControl(slug);
  const { rows: features } = await poolDe("control").query<{
    lookup_key: string;
    habilitada: boolean;
  }>("select lookup_key, habilitada from entitlements_efectivos where tenant_id = $1", [tenantId]);
  const entitlements = Object.fromEntries(features.map((f) => [f.lookup_key, f.habilitada]));
  const { rows: nueva } = await c.query<{ id: string }>(
    "select crear_config_version($1, $2::jsonb)::text as id",
    ["primera versión, sellada al necesitar la configuración", JSON.stringify(entitlements)],
  );
  return nueva[0]!.id;
}

/**
 * El estado de una feature en una versión de config: encendida, apagada, o SIN CONFIGURAR.
 *
 * Los tres estados son distintos y confundir dos de ellos rompe cosas opuestas:
 *
 *   · `true`  — alguien la encendió.
 *   · `false` — alguien la APAGÓ. Es una decisión con dueño y con motivo (§4.4 exige el
 *     `motivo` del override), y es la única que justifica marcar una captura con
 *     `modulo_apagado`: hubo una acción humana detrás.
 *   · `null`  — no está en el snapshot. Hoy es el caso NORMAL de todo tenant, porque los
 *     planes los siembra el hito (g) y `plan_features` está vacío. Leerlo como «apagada»
 *     pondría el flag `modulo_apagado` en cada captura de cada tenant y llenaría «Por
 *     revisar» de ruido desde el primer día — una bandeja así deja de mirarse en una semana.
 */
export async function estadoDeFeature(
  c: PoolClient,
  versionId: string,
  lookupKey: string,
): Promise<boolean | null> {
  const { rows } = await c.query<{ habilitada: boolean | null }>(
    "select (snapshot -> 'entitlements' ->> $2)::boolean as habilitada from config_version where id = $1",
    [versionId, lookupKey],
  );
  return rows[0]?.habilitada ?? null;
}

/**
 * ¿Está ENCENDIDA esta feature, según la config CONGELADA?
 *
 * Sin configurar cuenta como apagada, y para lo que consume esta función —el rebote de
 * planificación por documento vencido— es la respuesta correcta: encender por defecto algo que
 * nadie decidió es cómo un rebote aparece un martes en la cara de un operador que no cambió
 * nada. Quien necesite distinguir «apagada» de «sin configurar» usa `estadoDeFeature`.
 */
export async function entitlementVigente(
  c: PoolClient,
  slug: string,
  lookupKey: string,
): Promise<boolean> {
  const versionId = await versionVigente(c, slug);
  return (await estadoDeFeature(c, versionId, lookupKey)) === true;
}

/** Las features que este módulo consulta. Escritas una vez, para que el `lookup_key` no se
 *  tipee a mano en cada puerta — un typo resuelve APAGADO y el rebote deja de ocurrir sin que
 *  nada se ponga rojo. */
export const FEATURES = {
  documentos_vencidos_bloquean: "documentos_vencidos_bloquean",
  modulo_vehiculos: "modulo_vehiculos",
} as const;
