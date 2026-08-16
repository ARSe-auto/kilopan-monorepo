import type { Pool } from "pg";
import { DPA_VERSION, DPA_SECCIONES, type SeccionDpa } from "../../../../packages/miga/src/dpa.ts";
import { enActo, registrarEvento, EVENTOS } from "./gobierno.ts";
import type { Acto } from "./gobierno.ts";

// El DPA en términos del tenant [AC-FMIG-22] — §3.E1.15, §7.8, §5.4.
//
// El texto versionado vive en `packages/miga/src/dpa.ts` (§0: un solo lugar canónico). Este
// archivo solo resuelve DOS preguntas del panel: «¿qué versión está vigente para este tenant
// AHORA?» (la de `aceptado_en` más reciente) y «aceptar, escribiendo audit_trail Y el evento en
// el MISMO acto» — mismo criterio que cualquier otro `gobierno.*` (`emitirCodigoPuente`,
// `revocarAparato`).
//
// POR QUÉ NO HACE FALTA UNA FUNCIÓN SQL PROPIA: al revés que `disputar_linea` (0066), acá no hay
// RLS de rol `cliente` que proteger — la guardia de `admin_tenant` ya la resuelve `guardia()`
// ANTES de llegar acá — así que un INSERT parametrizado corriente, dentro de `enActo`, es
// suficiente y no repite la política que la BD no necesita imponer dos veces.

export type EstadoDpa = {
  version: string;
  secciones: readonly SeccionDpa[];
  aceptado: boolean;
  versionAceptada: string | null;
  aceptadoEn: string | null;
};

/** Lo que pinta la pantalla: el documento vigente y si ESTE tenant ya aceptó ESTA versión. Una
 *  versión aceptada distinta de `DPA_VERSION` (el documento subió de versión desde la última
 *  aceptación) se lee como `aceptado: false` — la propiedad que el AC pide («su versión vigente
 *  queda registrada por tenant») solo tiene sentido si «vigente» compara contra la de HOY. */
export async function obtenerEstadoDpa(pool: Pool): Promise<EstadoDpa> {
  const { rows } = await pool.query<{ version: string; aceptado_en: string }>(
    `select version, aceptado_en::text as aceptado_en
       from dpa_aceptaciones
      order by aceptado_en desc
      limit 1`,
  );
  const ultima = rows[0] ?? null;
  return {
    version: DPA_VERSION,
    secciones: DPA_SECCIONES,
    aceptado: ultima?.version === DPA_VERSION,
    versionAceptada: ultima?.version ?? null,
    aceptadoEn: ultima?.aceptado_en ?? null,
  };
}

/**
 * La aceptación. Idempotente sobre la versión VIGENTE del TENANT: un doble-tap, o un segundo
 * `admin_tenant` que vuelve a mirar la pantalla, no deja una segunda fila para la misma versión
 * — no porque el doble-tap sea peligroso acá (PLANIFICACIÓN, online, §4.2), sino porque una
 * bitácora con diez filas idénticas por cada vez que alguien refrescó la pantalla sería una
 * bitácora que nadie puede leer. Una versión NUEVA (`DPA_VERSION` subió) sí deja fila nueva:
 * es una aceptación distinta, de un documento distinto.
 */
export async function aceptarDpa(acto: Acto): Promise<{ yaAceptada: boolean; aceptadoEn: string }> {
  return enActo(
    acto.pool,
    async (c) => {
      const { rows } = await c.query<{ aceptado_en: string }>(
        `select aceptado_en::text as aceptado_en
           from dpa_aceptaciones
          where version = $1
          order by aceptado_en desc
          limit 1`,
        [DPA_VERSION],
      );
      if (rows[0]) return { yaAceptada: true, aceptadoEn: rows[0].aceptado_en };

      const { rows: nuevas } = await c.query<{ id: string; aceptado_en: string }>(
        `insert into dpa_aceptaciones (usuario_id, version)
         values ($1, $2)
         returning id::text as id, aceptado_en::text as aceptado_en`,
        [acto.sesion.usuarioId, DPA_VERSION],
      );
      const fila = nuevas[0]!;
      await registrarEvento(c, {
        codigo: EVENTOS.dpa_aceptado,
        objetoTabla: "dpa_aceptaciones",
        objetoId: fila.id,
        sesion: acto.sesion,
        payload: { version: DPA_VERSION },
      });
      return { yaAceptada: false, aceptadoEn: fila.aceptado_en };
    },
    acto.sesion,
  );
}
