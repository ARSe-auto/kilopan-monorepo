import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { enActo, offsetChileMin } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// AC-FMIG-03 — toques-hasta-completar por campo del teclado propio (§5.3, §4.6): mismo patrón
// puntual que `registrarToquesDrillDown` (AC-FSEM-05, servidor/review-queue.ts) — no tiene
// sentido esperar al próximo lote del outbox para saber cuántos toques tomó un campo de
// terreno. `client_uuid` es nuevo en cada llamada porque cada envío es una medición propia, no
// un evento con historia previa que deduplicar.
export async function registrarToquesDeCampo(
  pool: Pool,
  sesion: Sesion,
  flujo: string,
  toques: number,
): Promise<void> {
  await enActo(
    pool,
    async (c) => {
      const ahora = new Date();
      await c.query(
        `insert into client_metric (tipo, flujo, valor_int, ts, tz_offset_min, client_uuid)
         values ('toques_flujo', $1, $2, $3, $4, $5::uuid)`,
        [flujo, toques, ahora, offsetChileMin(ahora), randomUUID()],
      );
    },
    sesion,
  );
}
