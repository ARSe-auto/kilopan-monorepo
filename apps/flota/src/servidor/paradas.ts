import type { Pool, PoolClient } from "pg";
import { enLectura } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { evaluarCandadoDeEntrega, type CandadoDeEntrega } from "../dominio/candado-entrega.ts";
import {
  proyectarEstadoDeParada,
  type EstadoVisibleDeParada,
  type EventoDeParada,
} from "../dominio/proyeccion-parada.ts";

// El candado entrega←manifiesto [AC-FRUT-22] — KR-29, §4.2, §3.E1.5.
//
// Lee, no muta: la validación bloqueante vive en el CLIENTE contra el snapshot que esta lectura
// sirve (§4.2). El servidor no rechaza nada acá — solo dice la verdad sobre qué empresas tienen
// su sub-manifiesto confirmado, para que la pantalla decida si ofrece «Llegué».

export type EstadoDeLaParada =
  | { tipo: "no_es_entrega" }
  | ({ tipo: "entrega" } & CandadoDeEntrega);

/**
 * El candado de UNA parada de entrega: todas las empresas de sus ítems necesitan su
 * sub-manifiesto confirmado en ALGUNA parada de carga de la misma ruta (§3.E1.5 — la
 * consolidación multi-empresa hace que una entrega dependa de más de una carga).
 */
export async function candadoDeLaEntrega(
  pool: Pool,
  sesion: Sesion,
  paradaId: string,
): Promise<EstadoDeLaParada> {
  return enLectura(pool, sesion, (c) => candadoDeLaParadaEn(c, paradaId));
}

/**
 * El mismo juicio, sobre una conexión que YA está en un acto abierto [AC-FRUT-23].
 *
 * Existe separado de `candadoDeLaEntrega` porque el motor de sync lo necesita DENTRO de la
 * transacción en la que la captura aterriza (`servidor/capturas.ts`): abrir un `enLectura` propio
 * ahí adentro sería una segunda conexión que no ve lo que la transacción en vuelo escribió, y
 * —peor— dos copias del mismo SQL que se separan el día que alguien ajuste una. El candado que el
 * cliente ve y el que el servidor deja dicho tienen que salir de la MISMA lectura.
 */
export async function candadoDeLaParadaEn(
  c: PoolClient,
  paradaId: string,
): Promise<EstadoDeLaParada> {
  const { rows: parada } = await c.query<{ tipo: string; ruta_id: string }>(
    "select tipo, ruta_id::text as ruta_id from paradas where id = $1",
    [paradaId],
  );
  if (!parada[0] || parada[0].tipo !== "entrega") return { tipo: "no_es_entrega" as const };

  const { rows: empresas } = await c.query<{ id: string; razon_social: string }>(
    `select distinct ec.id::text as id, ec.razon_social
       from items i join empresas_cliente ec on ec.id = i.empresa_cliente_id
      where i.parada_id = $1
      order by ec.razon_social`,
    [paradaId],
  );

  const { rows: confirmadas } = await c.query<{ empresa_cliente_id: string }>(
    `select distinct m.empresa_cliente_id::text as empresa_cliente_id
       from manifiestos m
       join paradas cp on cp.id = m.parada_id
      where cp.ruta_id = $1 and cp.tipo = 'carga'`,
    [parada[0].ruta_id],
  );

  const candado = evaluarCandadoDeEntrega({
    empresasDeLaEntrega: empresas.map((e) => ({ id: e.id, razonSocial: e.razon_social })),
    empresasConManifiestoConfirmado: new Set(confirmadas.map((f) => f.empresa_cliente_id)),
  });

  return { tipo: "entrega" as const, ...candado };
}

// ─── El estado visible: proyección de `eventos`, jamás un contador mutable [AC-FPOD-21] ────────
// §4.6, §2.
//
// `paradas.estado`/`resultado` (0037) nacen `pending` y esta función NUNCA los toca: leerlos
// directo sería exactamente el «contador mutable» que el AC prohíbe — una columna que alguien
// tiene que acordarse de actualizar, y que puede quedar desfasada de lo que `eventos` dice de
// verdad. En su lugar, cada lectura recalcula desde los hechos, ordenados por `secuencia` — el
// orden AUTORITATIVO del servidor (asignado al aterrizar, nunca por `event_time` del aparato) —
// con `dominio/proyeccion-parada.ts::proyectarEstadoDeParada`, la función PURA que decide cuál
// hecho manda. `gate-sin-contadores-mutables.mjs` vigila que ningún `UPDATE paradas SET estado`/
// `resultado` se cuele por otro archivo.
export async function estadoVisibleDeParada(
  pool: Pool,
  sesion: Sesion,
  paradaId: string,
): Promise<EstadoVisibleDeParada | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows: existe } = await c.query("select 1 from paradas where id = $1", [paradaId]);
    if (!existe[0]) return null;

    const { rows } = await c.query<{ secuencia: string; payload: EventoDeParada["payload"] }>(
      `select e.secuencia::text as secuencia, e.payload
         from eventos e join evento_tipo t on t.id = e.tipo_id
        where e.objeto_tabla = 'paradas' and e.objeto_id = $1
          and t.codigo in ('entrega.pod_capturada', 'entrega.pod_deshecha')`,
      [paradaId],
    );

    return proyectarEstadoDeParada(
      rows.map((r) => ({ secuencia: Number(r.secuencia), payload: r.payload })),
    );
  });
}
