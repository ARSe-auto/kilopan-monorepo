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
  certificaciones_vencidas_bloquean: "certificaciones_vencidas_bloquean",
  // El módulo de encargos, rutas y custodia. Apagarlo NO rebota una captura de terreno: la
  // marca con `modulo_apagado` y la deja entrar [AC-FRUT-10] (§0, §5.5).
  modulo_encargos: "modulo_encargos",
  // El namespace `/cliente/*`, el `feature_lookup_key` que `modo_recorte` apaga en `mi_flota`
  // (db/migraciones-flota/control/0003_modo_como_preset.sql) [AC-FPOR-04]. El portal es 100%
  // planificación/lectura: apagado ⇒ 403 en TODA ruta del namespace, jamás el flag de captura.
  portal_contratante: "portal_contratante",
  // Las otras tres del grupo DaaS [AC-FTAR-18], sembradas en el catálogo de `control` por la
  // 0009 (`db/migraciones-flota/control/0009_features_del_grupo_daas.sql`). Juntas con
  // `portal_contratante` son EXACTAMENTE las cuatro filas que `modo_recorte` apaga en
  // `mi_flota`, y las mismas cuatro claves que el manifest de navegación ya evalúa una por una
  // (`dominio/manifest.ts`, MODULOS_GRUPO_DAAS, AC-FPOR-03). Escribirlas acá cierra el círculo:
  // la puerta HTTP del módulo 06 lee el MISMO `lookup_key` que el manifest, así que un módulo
  // que no aparece en la navegación tampoco contesta por la API.
  tarifas: "tarifas",
  liquidacion_por_cliente: "liquidacion_por_cliente",
  facturacion: "facturacion",
} as const;

/**
 * ¿Está ENCENDIDO este módulo, según la config VIGENTE? [AC-FMIG-09] — §5.5, §0.
 *
 * El default es AL REVÉS que `entitlementVigente`, y a propósito: un «bloquean» del §4.5 nace
 * apagado (encender es la excepción que alguien pide), pero un MÓDULO del §5.5 nace prendido —
 * es el tamaño del producto tal como lo compraron— y se apaga con una decisión humana explícita
 * desde «Funciones». Por eso acá «sin configurar» cuenta ENCENDIDO, el mismo criterio que ya usa
 * el lado de captura (`estadoDeFeature(...) !== false` en `lecturas.ts`/`capturas.ts`/
 * `manifiestos.ts`): el guard de planificación/lectura tiene que dar la MISMA respuesta que el
 * flag de captura para el mismo `lookup_key` — apagar un módulo no puede significar «403 en
 * planificación» y «encendido para el terreno» a la vez sobre el mismo interruptor.
 *
 * Lee la VIGENTE, no la congelada de un turno: a diferencia de una captura (que juzga un hecho
 * ya ocurrido contra la config con la que el turno abrió), una pantalla de planificación o de
 * lectura consulta el estado de AHORA — el mismo criterio que ya usan los rebotes de
 * `documentos_vencidos_bloquean`/`certificaciones_vencidas_bloquean` en `turnos.ts`/`agenda.ts`/
 * `rutas.ts`.
 */
export async function moduloVigenteEncendido(
  c: PoolClient,
  slug: string,
  lookupKey: string,
): Promise<boolean> {
  const versionId = await versionVigente(c, slug);
  return (await estadoDeFeature(c, versionId, lookupKey)) !== false;
}

/** El 403 de la regla de contracción [AC-FMIG-09] — §5.5, §0: «módulo apagado ⇒ 403 SOLO en
 *  endpoints de planificación/lectura». Tipado es-CL (§4.2) para que la pantalla que lo reciba
 *  pueda decir qué pasó sin traducir un código. */
export const moduloApagadoRespuesta = (): Response =>
  Response.json(
    {
      error: "modulo_apagado",
      mensaje: "El administrador apagó este módulo para esta cuenta desde «Funciones».",
    },
    { status: 403 },
  );
