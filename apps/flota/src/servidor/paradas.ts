import type { Pool } from "pg";
import { enLectura } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { evaluarCandadoDeEntrega, type CandadoDeEntrega } from "../dominio/candado-entrega.ts";

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
  return enLectura(pool, sesion, async (c) => {
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
  });
}
