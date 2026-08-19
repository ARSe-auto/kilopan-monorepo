import type { Pool } from "pg";
import { enLectura } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import type { FilaExportPod } from "../dominio/export-pods.ts";

// Export de PODs por rango [AC-FTEL-07] — §11: mismo criterio de acceso que la torre de
// control y las liquidaciones (AC-FTEL-04, AC-FTAR-07) — es una pantalla del GESTOR, no del
// terreno (§8: el chofer jamás ve CLP ni el detalle de facturación) ni del contratante (§4.3
// confina al rol `cliente` a su rebanada del portal, que no incluye este export).
const ROLES_CON_ACCESO = new Set(["admin_tenant", "operador"]);

export function puedeExportarPods(rol: string): boolean {
  return ROLES_CON_ACCESO.has(rol);
}

type FilaCruda = {
  fecha_servicio: string;
  empresa: string;
  encargo_id: string;
  destino: string;
  bultos_planificados: number;
  bultos_entregados: number | null;
  bultos_rechazados: number | null;
  evidencia_tipo: string | null;
  evidencia_sha256: string | null;
};

/**
 * Las filas del export, rango + empresa (§11 punto 4). Grano = `items`: una fila por encargo
 * dentro de una parada de tipo `entrega` (0037), con la evidencia MÁS RECIENTE de esa parada
 * como referencia (§4.6, AC-FPOD-19) — el sha256 sale en hexadecimal o `null` cuando la
 * captura fue de un tipo sin binario (firma o PIN sin foto encima, `evidence_binario_con_sha256`).
 *
 * `enLectura` aplica la RLS de la sesión: un `empresaId` de OTRO tenant sencillamente no
 * encuentra filas —cada tenant es su propia base, §4.1— y no hace falta filtrar `tenant_id` a
 * mano.
 */
export async function podsPorRango(
  pool: Pool,
  sesion: Sesion,
  rango: { desde: string; hasta: string; empresaId: string },
): Promise<FilaExportPod[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<FilaCruda>(
      `select to_char(r.fecha_servicio, 'YYYY-MM-DD') as fecha_servicio,
              ec.razon_social as empresa,
              i.encargo_id::text as encargo_id,
              d.nombre as destino,
              i.qty_planificada as bultos_planificados,
              i.qty_entregada as bultos_entregados,
              i.qty_rechazada as bultos_rechazados,
              ev.tipo::text as evidencia_tipo,
              encode(ev.sha256, 'hex') as evidencia_sha256
         from items i
         join paradas p on p.id = i.parada_id and p.tipo = 'entrega'
         join rutas r on r.id = p.ruta_id
         join destinos d on d.id = p.destino_id
         join empresas_cliente ec on ec.id = i.empresa_cliente_id
         left join lateral (
           select tipo, sha256 from evidence
            where objeto_tabla = 'paradas' and objeto_id = p.id
            order by capturada_en desc
            limit 1
         ) ev on true
        where i.empresa_cliente_id = $1
          and r.fecha_servicio between $2 and $3
        order by r.fecha_servicio, p.orden, i.encargo_id`,
      [rango.empresaId, rango.desde, rango.hasta],
    );
    return rows;
  });
}
