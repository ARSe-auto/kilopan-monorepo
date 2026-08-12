import type { Pool } from "pg";
import { enActo } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// La transición `nueva → reconocida` del Peek N1 [AC-FSEM-04] — spec 05 §2.2, §2.4, §4.
//
// `review_queue` ya existe (migración 0002, módulo 00): la tabla nace en `tenant_template`
// con su propio ciclo `nueva → reconocida → resuelta` y su auditoría por trigger. Lo que
// faltaba era QUIÉN puede moverla y qué pasa cuando alguien la mueve dos veces — y eso es
// PLANIFICACIÓN (§4.2): se opera con red y rebota, nunca una captura de terreno.
//
// El UPDATE lleva `estado = 'nueva'` en el WHERE y no un SELECT-luego-UPDATE separado: así
// la fila que dos dueños tocan a la vez decide un solo ganador de verdad (la BD serializa el
// UPDATE), en vez de que los dos lean "nueva" y los dos crean que ganaron. El segundo se
// entera del 422 con un SELECT de verificación DESPUÉS de fallar el UPDATE, no antes.
export type ResultadoReconocer =
  | { tipo: "ok"; id: string; asignadoA: string; reconocidaEn: Date }
  | { tipo: "no_existe" }
  | { tipo: "transicion_ilegal"; estadoActual: string };

export async function reconocerExcepcion(pool: Pool, sesion: Sesion, id: string): Promise<ResultadoReconocer> {
  return enActo(
    pool,
    async (c) => {
      const { rows } = await c.query<{ id: string; asignado_a: string; reconocida_en: Date }>(
        `update review_queue
            set estado = 'reconocida', asignado_a = $2, reconocida_en = now()
          where id = $1 and tenant_id = tenant_actual() and estado = 'nueva'
          returning id::text as id, asignado_a::text as asignado_a, reconocida_en`,
        [id, sesion.usuarioId],
      );
      const fila = rows[0];
      if (fila) {
        return { tipo: "ok", id: fila.id, asignadoA: fila.asignado_a, reconocidaEn: fila.reconocida_en };
      }

      const { rows: existente } = await c.query<{ estado: string }>(
        "select estado::text as estado from review_queue where id = $1 and tenant_id = tenant_actual()",
        [id],
      );
      if (!existente[0]) return { tipo: "no_existe" };
      return { tipo: "transicion_ilegal", estadoActual: existente[0].estado };
    },
    sesion,
  );
}
