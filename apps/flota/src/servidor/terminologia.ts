import type { Pool } from "pg";
import {
  resolverTermino,
  resolverTerminologiaCompleta,
  TERMINOLOGIA_BASE_ES_CL,
  type TerminoResuelto,
  type OverrideTermino,
  type TerminoTipo,
} from "../../../../packages/miga/src/terminologia.ts";

// El lado servidor de AC-FMIG-04: leer las filas de `tenant_terminology` del tenant vigente y
// resolver el catálogo completo por la cadena tenant → vertical → base es-CL. La resolución en
// sí (quién gana) vive en `packages/miga` — acá solo se traduce la fila de la BD al tipo que
// esa función espera. El nivel VERTICAL no lee nada todavía: `vertical_template` no existe
// (ver el comentario de cabecera de `terminologia.ts`).

type Fila = { term_key: string; singular: string; plural: string };

/** Las filas de `tenant_terminology` del tenant actual, indexadas por `term_key` — nivel
 *  TENANT de la cadena de resolución (AC-FTEN-10 es la autoridad de estas filas). */
export async function overridesDeTenant(pool: Pool): Promise<Record<string, OverrideTermino>> {
  const { rows } = await pool.query<Fila>("select term_key, singular, plural from tenant_terminology");
  const overrides: Record<string, OverrideTermino> = {};
  for (const fila of rows) overrides[fila.term_key] = { singular: fila.singular, plural: fila.plural };
  return overrides;
}

/** El catálogo COMPLETO ya resuelto para el tenant actual — lo que sirve `GET /api/terminologia`,
 *  SIEMPRE en vivo (§4.4: «el cambio aplica al próximo bootstrap»; no hay turno de por medio). */
export async function terminologiaDelTenant(pool: Pool): Promise<Record<string, TerminoResuelto>> {
  const overridesTenant = await overridesDeTenant(pool);
  return resolverTerminologiaCompleta({ overridesTenant });
}

// ─── Edición [AC-FMIG-06] — §5.1, §4.4, §4.2 ────────────────────────────────────────

export type GuardarTerminoResultado =
  | { tipo: "ok"; termino: TerminoResuelto }
  | { tipo: "termino_no_editable" }
  | { tipo: "vacio" }
  | { tipo: "largo_excedido"; tipoTermino: TerminoTipo }
  | { tipo: "caracter_prohibido" };

/**
 * Edita UN término del catálogo del tenant [AC-FMIG-06].
 *
 * El whitelist es `TERMINOLOGIA_BASE_ES_CL`: un `term_key` que no está ahí no es un renombrable
 * legítimo —ni lo son los términos de sistema/auditoría, que nunca entraron al catálogo—, así
 * que ni siquiera se intenta el UPDATE («términos de sistema/auditoría no aparecen como
 * editables»). Los otros rebotes (largo por tipo, caracteres prohibidos, singular/plural
 * vacíos) los decide la BD (`tenant_terminology_*`, AC-FTEN-10, §4.4) y acá solo se traduce el
 * `constraint` violado al 422 tipado es-CL que pide el §4.2.
 *
 * Un edit exitoso SELLA una `config_version` nueva —arrastrando los entitlements vigentes, que
 * este AC no toca— para que el cambio aplique al PRÓXIMO bootstrap sin desenganchar los turnos
 * YA abiertos: esos siguen apuntando a su `config_version_id` viejo, congelado (§4.4). Si
 * todavía no hay ninguna versión sellada, acá no se fuerza una: la primera la sella
 * `versionVigente` (servidor/config.ts) leyendo los entitlements REALES de `control` — sellar
 * acá con `{}` los pisaría con un snapshot vacío antes de que nadie los haya leído.
 */
export async function guardarTermino(
  pool: Pool,
  termKeyCrudo: unknown,
  singularCrudo: unknown,
  pluralCrudo: unknown,
): Promise<GuardarTerminoResultado> {
  if (typeof termKeyCrudo !== "string" || !(termKeyCrudo in TERMINOLOGIA_BASE_ES_CL)) {
    return { tipo: "termino_no_editable" };
  }
  if (typeof singularCrudo !== "string" || typeof pluralCrudo !== "string") {
    return { tipo: "vacio" };
  }
  const termKey = termKeyCrudo;
  const tipo = TERMINOLOGIA_BASE_ES_CL[termKey]!.tipo;

  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    try {
      await cliente.query(
        `insert into tenant_terminology (term_key, tipo, singular, plural)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, term_key) do update set
           tipo = excluded.tipo, singular = excluded.singular, plural = excluded.plural`,
        [termKey, tipo, singularCrudo, pluralCrudo],
      );
    } catch (e) {
      await cliente.query("rollback");
      const error = e as { code?: string; constraint?: string };
      if (error.code === "23514") {
        if (error.constraint === "tenant_terminology_no_vacios") return { tipo: "vacio" };
        if (error.constraint === "tenant_terminology_largo_por_tipo") {
          return { tipo: "largo_excedido", tipoTermino: tipo };
        }
        if (error.constraint === "tenant_terminology_caracteres_prohibidos") {
          return { tipo: "caracter_prohibido" };
        }
        if (error.constraint === "tenant_terminology_sin_terminos_de_sistema") {
          return { tipo: "termino_no_editable" };
        }
      }
      throw e;
    }

    // Arrastra los entitlements de la versión vigente — este AC edita terminología, no
    // entitlements, y un snapshot nuevo con `{}` los apagaría a todos de un plumazo.
    const { rows: vigente } = await cliente.query<{ entitlements: unknown }>(
      "select snapshot -> 'entitlements' as entitlements from config_version order by id desc limit 1",
    );
    if (vigente[0]) {
      await cliente.query("select crear_config_version($1, $2::jsonb)", [
        `edición de terminología: ${termKey}`,
        JSON.stringify(vigente[0].entitlements ?? {}),
      ]);
    }

    await cliente.query("commit");
    return {
      tipo: "ok",
      termino: resolverTermino({
        termKey,
        overridesTenant: { [termKey]: { singular: singularCrudo, plural: pluralCrudo } },
      }),
    };
  } finally {
    cliente.release();
  }
}

// ─── Congelamiento por turno [AC-FMIG-06] — §4.4 ────────────────────────────────────

type FilaSnapshot = { term_key: string; singular: string; plural: string };

/** Los overrides de terminología tal como quedaron SELLADOS en una `config_version` —jamás la
 *  fila viva de `tenant_terminology`, que puede haber cambiado después de sellarla. */
async function overridesDeVersion(pool: Pool, configVersionId: string): Promise<Record<string, OverrideTermino>> {
  const { rows } = await pool.query<{ filas: FilaSnapshot[] }>(
    "select coalesce(snapshot -> 'tenant_terminology', '[]'::jsonb) as filas from config_version where id = $1",
    [configVersionId],
  );
  const overrides: Record<string, OverrideTermino> = {};
  for (const fila of rows[0]?.filas ?? []) overrides[fila.term_key] = { singular: fila.singular, plural: fila.plural };
  return overrides;
}

/**
 * El catálogo resuelto de UN turno, congelado a su `config_version_id` (§4.4: «un turno abierto
 * termina con su config_version_id congelado»). `null` si el turno no existe.
 *
 * A propósito NO lee `tenant_terminology` en vivo: es la diferencia con `terminologiaDelTenant`
 * —la del panel admin, que sí es en vivo— y es lo que hace que editar un término a mitad de
 * turno no le cambie el piso a quien ya está en la calle con esa jornada abierta.
 */
export async function terminologiaDeTurno(
  pool: Pool,
  turnoId: string,
): Promise<Record<string, TerminoResuelto> | null> {
  const { rows } = await pool.query<{ config_version_id: string }>(
    "select config_version_id::text as config_version_id from turnos where id = $1",
    [turnoId],
  );
  const turno = rows[0];
  if (!turno) return null;
  const overridesTenant = await overridesDeVersion(pool, turno.config_version_id);
  return resolverTerminologiaCompleta({ overridesTenant });
}
