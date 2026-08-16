import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { enActo, offsetChileMin } from "./gobierno.ts";
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

// Reasignar en el Detalle N2 [AC-FSEM-20] — spec 05 §2.3: «reasignar transfiere `asignado_a`
// a otro usuario del tenant» (PLANIFICACIÓN §4.2: valida online y rebota).
//
// Dos cosas pueden estar mal, y el orden de los rebotes importa: si la excepción no existe
// (o es de otro tenant — 404 por construcción, `tenant_id = tenant_actual()` en el WHERE), eso
// manda SIEMPRE, incluso si el `usuarioId` tampoco es válido — el 404 no debe filtrar si el
// cuerpo del request estaba bien formado. Solo con la excepción presente se distingue
// `usuario_invalido` de `transicion_ilegal`.
//
// El UPDATE no toca `estado`: reasignar es un cambio de DUEÑO, no una transición de ciclo de
// vida (§4.6). El WHERE lleva `estado <> 'resuelta'` — una excepción cerrada ya no tiene a
// quién asignarle nada, mismo criterio que «el rojo lo exige» en `resolverExcepcion`: no hay
// atajo de vuelta a una fila que ya terminó su ciclo.
//
// `audit_trail` lo escribe el trigger `review_queue_auditada` (migración 0002) por sí solo —
// no hace falta un `registrarEvento` acá, mismo criterio que `reconocerExcepcion`.
export type ResultadoReasignar =
  | { tipo: "ok"; id: string; asignadoA: string }
  | { tipo: "no_existe" }
  | { tipo: "transicion_ilegal"; estadoActual: string }
  | { tipo: "usuario_invalido" };

export async function reasignarExcepcion(
  pool: Pool,
  sesion: Sesion,
  id: string,
  usuarioId: string,
): Promise<ResultadoReasignar> {
  return enActo(
    pool,
    async (c) => {
      const { rows: usuario } = await c.query(
        "select 1 from usuarios where id = $1 and tenant_id = tenant_actual() and activo",
        [usuarioId],
      );
      const usuarioValido = usuario.length > 0;

      if (usuarioValido) {
        const { rows } = await c.query<{ id: string; asignado_a: string }>(
          `update review_queue
              set asignado_a = $2
            where id = $1 and tenant_id = tenant_actual() and estado <> 'resuelta'
            returning id::text as id, asignado_a::text as asignado_a`,
          [id, usuarioId],
        );
        const fila = rows[0];
        if (fila) return { tipo: "ok", id: fila.id, asignadoA: fila.asignado_a };
      }

      const { rows: existente } = await c.query<{ estado: string }>(
        "select estado::text as estado from review_queue where id = $1 and tenant_id = tenant_actual()",
        [id],
      );
      if (!existente[0]) return { tipo: "no_existe" };
      if (!usuarioValido) return { tipo: "usuario_invalido" };
      return { tipo: "transicion_ilegal", estadoActual: existente[0].estado };
    },
    sesion,
  );
}

// El conteo de toques del drill-down [AC-FSEM-05] — spec 05 §2.3 («rojo→detalle ≤2 toques
// desde «Hoy»») y §5 («toques del drill-down a `client_metric` tipo `toques_flujo`», §5.3,
// §4.6). El camino natural desde `hoy/tablero-de-hoy.tsx` es EXACTAMENTE 2: tocar la tarjeta
// abre el peek (N1) y «Ver detalle» navega a acá (N2) — no hay un tercer toque que contar.
//
// `client_metric` es CAPTURA, ingerida en lote por `/api/sync/capturas` según el comentario
// de su propia migración (0002) — pero `servidor/entorno.ts` (`declararEntorno`,
// `persist_denegado`) ya sienta el precedente de un segundo camino: una métrica puntual, del
// tamaño de un evento, que no tiene sentido esperar hasta el próximo lote del outbox. El
// conteo de toques es el mismo caso: se sabe apenas se llega a N2, y esperar al sync
// convertiría «cuántos toques» en «cuántos toques, con horas de atraso».
//
// `client_uuid` es la llave de idempotencia de la tabla (`unique(tenant_id, client_uuid)`):
// una nueva por llamada, porque cada llegada a N2 es una medición propia — a diferencia de
// `persist_denegado`, que dedupe por APARATO, acá lo que se cuenta es el EVENTO de drill-down.
export async function registrarToquesDrillDown(
  pool: Pool,
  sesion: Sesion,
  excepcionId: string,
  toques: number,
): Promise<"ok" | "no_existe"> {
  return enActo(
    pool,
    async (c) => {
      const { rows } = await c.query(
        "select 1 from review_queue where id = $1 and tenant_id = tenant_actual()",
        [excepcionId],
      );
      if (!rows[0]) return "no_existe";

      const ahora = new Date();
      await c.query(
        `insert into client_metric (tipo, flujo, valor_int, ts, tz_offset_min, client_uuid)
         values ('toques_flujo', 'semaforo_n2', $1, $2, $3, $4::uuid)`,
        [toques, ahora, offsetChileMin(ahora), randomUUID()],
      );
      return "ok";
    },
    sesion,
  );
}
