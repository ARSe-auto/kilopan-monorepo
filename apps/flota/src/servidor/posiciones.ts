import type { Pool } from "pg";
import { enActo } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// La captura de posición en vivo [AC-FTEL-01] — §7.8, §11.
//
// SOLO la puerta de UN punto por vez. El lote batcheado por el motor de sync existente (outbox,
// replay, idempotencia por `client_uuid`) es AC-FTEL-03 y no se adelanta acá: este archivo no
// toca `/api/sync/capturas`. Lo que este AC necesita es que la privacidad del §7.8 sea real
// desde el primer INSERT, y esa guarda vive en la BASE (0074, trigger
// `posiciones_exige_turno_abierto`) — acá se traduce su rebote, no se reimplementa.

export type CapturaDePosicion = { turnoId: string; lat: number; lng: number };

export type ResultadoDePosicion = { tipo: "ok"; id: string } | { tipo: "turno_no_abierto" };

/** El SQLSTATE que la 0074 usa para el rebote de privacidad — mismo código que el resto de la
 *  base usa para una violación de restricción de negocio contra el estado de una fila ajena. */
const CHECK_VIOLATION = "23514";

export async function capturarPosicion(
  pool: Pool,
  sesion: Sesion,
  datos: CapturaDePosicion,
): Promise<ResultadoDePosicion> {
  try {
    return await enActo(
      pool,
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into posiciones (turno_id, lat, lng) values ($1, $2, $3) returning id::text as id",
          [datos.turnoId, datos.lat, datos.lng],
        );
        return { tipo: "ok", id: rows[0]!.id };
      },
      sesion,
    );
  } catch (error) {
    // El trigger de la 0074, traducido: un turno que no está abierto no es un 500, es la
    // privacidad del §7.8 haciendo su trabajo.
    if ((error as { code?: string }).code === CHECK_VIOLATION) {
      return { tipo: "turno_no_abierto" };
    }
    throw error;
  }
}
