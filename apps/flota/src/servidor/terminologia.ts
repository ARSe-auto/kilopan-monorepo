import type { Pool } from "pg";
import { resolverTerminologiaCompleta, type TerminoResuelto, type OverrideTermino } from "../../../../packages/miga/src/terminologia.ts";

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

/** El catálogo COMPLETO ya resuelto para el tenant actual — lo que sirve `GET /api/terminologia`. */
export async function terminologiaDelTenant(pool: Pool): Promise<Record<string, TerminoResuelto>> {
  const overridesTenant = await overridesDeTenant(pool);
  return resolverTerminologiaCompleta({ overridesTenant });
}
