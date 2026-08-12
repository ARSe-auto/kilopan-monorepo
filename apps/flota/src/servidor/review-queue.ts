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

// El Detalle N2 [AC-FSEM-05] — spec 05 §2.3: `reconocida → resuelta` con nota OBLIGATORIA.
//
// La nota se valida ACÁ, antes de tocar la base, y no solo con el CHECK
// `review_queue_resuelta_con_nota` de la migración 0002: el CHECK es el backstop que impide
// que una fila resuelta sin nota exista aunque alguien se salte esta función, pero devolver
// su 23514 tal cual sería un 500 sin tipar — y este endpoint necesita el mismo 422 tipado que
// el resto del acto de gobierno (§4.2).
//
// El WHERE lleva `estado = 'reconocida'`, no `estado <> 'resuelta'`: resolver una excepción
// que sigue `nueva` es TAN ilegal como re-resolver una ya resuelta — «el rojo lo exige»
// (§2.3) es justamente que no hay atajo de `nueva` a `resuelta` sin pasar por reconocer.
export type ResultadoResolver =
  | { tipo: "ok"; id: string; resueltaEn: Date }
  | { tipo: "no_existe" }
  | { tipo: "transicion_ilegal"; estadoActual: string }
  | { tipo: "nota_vacia" };

export async function resolverExcepcion(
  pool: Pool,
  sesion: Sesion,
  id: string,
  nota: string,
): Promise<ResultadoResolver> {
  if (nota.trim() === "") return { tipo: "nota_vacia" };

  return enActo(
    pool,
    async (c) => {
      const { rows } = await c.query<{ id: string; resuelta_en: Date }>(
        `update review_queue
            set estado = 'resuelta', nota = $2, resuelta_en = now()
          where id = $1 and tenant_id = tenant_actual() and estado = 'reconocida'
          returning id::text as id, resuelta_en`,
        [id, nota],
      );
      const fila = rows[0];
      if (fila) {
        return { tipo: "ok", id: fila.id, resueltaEn: fila.resuelta_en };
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
