import type { Pool, PoolClient } from "pg";
import { enActo, registrarEvento, tenantIdEnControl, EVENTOS_OPERACION } from "./gobierno.ts";
import { poolDe } from "./conexion.ts";
import type { Sesion } from "./sesion.ts";
import { ROLES, type Rol } from "../../../../packages/nucleo-comun/src/constants.ts";

// La apertura del vehículo-día [AC-FVEH-06] — §4.5, §4.4, §2, §9.3 centinela 5.
//
// ─── EL SOLAPE LO DECIDE LA BASE ─────────────────────────────────────────────────────
//
// Acá no hay un `select` que pregunte «¿ya hay un turno abierto?». Ese chequeo es una carrera:
// dos aperturas simultáneas del mismo vehículo pasan las dos por el hueco y la jornada queda
// duplicada — dos odómetros, dos vehículos-día para la EEVD (§2). El EXCLUDE de `turnos` lo
// resuelve PostgreSQL, que es el único que ve las dos a la vez, y acá solo se traduce su
// `23P01` al 422 tipado que el §4.2 pide de una mutación de planificación. Como la violación
// aborta la transacción entera, el rebote es de CERO filas por construcción.
//
// ─── LA CONFIGURACIÓN SE CONGELA AL ABRIR, Y CON LOS ENTITLEMENTS DE VERDAD ──────────
//
// El §4.4 dice que un turno corre entero con UNA versión, así que `config_version_id` es NOT
// NULL. Si el tenant todavía no tiene ninguna versión sellada —hoy nadie más las sella—, la
// apertura sella la primera, y lo hace con los entitlements efectivos LEÍDOS de `control`. No
// con `{}`: un snapshot vacío se ve igual que uno donde todas las features están apagadas, y
// mañana alguien leería «este turno corrió sin el módulo X» sobre un turno que sí lo tenía.
// La lectura va por la conexión propia a `control` (§4.1 prohíbe la consulta cross-database,
// no tener dos conexiones), igual que `tenantIdEnControl`.
//
// La deriva de versión con turno abierto —cambiar `parametros` no altera el turno en curso y
// sí el siguiente— es de AC-FVEH-18 y no se adelanta acá.

/** Quién puede abrir una jornada. `cliente` no: es la empresa CONTRATANTE (§4.3), que mira su
 *  portal y no opera vehículos; abrirle un turno le daría un vehículo-día que no es suyo. */
export const ROLES_QUE_ABREN_TURNO: readonly Rol[] = ROLES.filter((r) => r !== "cliente");

export type Turno = {
  id: string;
  vehiculo_id: string;
  config_version_id: string;
  estado: string;
  abierto_en: Date;
  cerrado_en: Date | null;
};

export type AperturaDeTurno =
  | { tipo: "ok"; turno: Turno }
  | { tipo: "vehiculo_no_existe" }
  | { tipo: "vehiculo_inactivo" }
  | { tipo: "turno_solapado" };

const COLUMNAS = `id::text as id, vehiculo_id::text as vehiculo_id,
                  config_version_id::text as config_version_id, estado::text as estado,
                  abierto_en, cerrado_en`;

/** El código que PostgreSQL usa para una violación de restricción EXCLUDE. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * La versión vigente de la configuración, sellando la primera si el tenant no tiene ninguna.
 *
 * `slug` es el del RUTEO —lo sobrescribe `servidor.mjs` con el veredicto de `control`, jamás
 * llega del cliente— y de ahí sale el id con el que se leen los entitlements del plano de
 * control.
 */
async function versionVigente(c: PoolClient, slug: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "select id::text as id from config_version order by id desc limit 1",
  );
  if (rows[0]) return rows[0].id;

  const tenantId = await tenantIdEnControl(slug);
  const { rows: features } = await poolDe("control").query<{
    lookup_key: string;
    habilitada: boolean;
  }>(
    "select lookup_key, habilitada from entitlements_efectivos where tenant_id = $1",
    [tenantId],
  );
  const entitlements = Object.fromEntries(features.map((f) => [f.lookup_key, f.habilitada]));
  const { rows: nueva } = await c.query<{ id: string }>(
    "select crear_config_version($1, $2::jsonb)::text as id",
    ["primera versión, sellada al abrir un turno", JSON.stringify(entitlements)],
  );
  return nueva[0]!.id;
}

export async function abrirTurno(
  pool: Pool,
  sesion: Sesion,
  slug: string,
  vehiculoId: string,
): Promise<AperturaDeTurno> {
  try {
    return await enActo(pool, async (c) => {
      const { rows: vehiculo } = await c.query<{ activo: boolean }>(
        "select activo from vehiculos where id = $1",
        [vehiculoId],
      );
      if (vehiculo.length === 0) return { tipo: "vehiculo_no_existe" };
      // Un vehículo desactivado no abre jornada: el §5.4 le da al dueño la desactivación para
      // sacarlo de la operación, y dejarlo abrir turnos igual vaciaría ese acto de contenido.
      if (!vehiculo[0]!.activo) return { tipo: "vehiculo_inactivo" };

      const configVersionId = await versionVigente(c, slug);
      const { rows } = await c.query<Turno>(
        `insert into turnos (vehiculo_id, config_version_id) values ($1, $2)
         returning ${COLUMNAS}`,
        [vehiculoId, configVersionId],
      );
      const turno = rows[0]!;
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.turno_abierto,
        objetoTabla: "turnos",
        objetoId: turno.id,
        sesion,
        payload: { vehiculo_id: vehiculoId, config_version_id: configVersionId },
      });
      return { tipo: "ok", turno };
    });
  } catch (error) {
    // El EXCLUDE de la base, traducido. Cualquier otro error sube: un 500 honesto es mejor
    // que un 422 que le dice a quien abre el turno que el problema es suyo.
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return { tipo: "turno_solapado" };
    }
    throw error;
  }
}

/** Los turnos del tenant, del más reciente al más viejo. */
export async function listarTurnos(pool: Pool): Promise<Turno[]> {
  const { rows } = await pool.query<Turno>(
    `select ${COLUMNAS} from turnos order by abierto_en desc`,
  );
  return rows;
}
