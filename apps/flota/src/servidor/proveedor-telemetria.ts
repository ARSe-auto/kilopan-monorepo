import type { Pool, PoolClient } from "pg";
import { esCodigoDelRegistro, type CodigoProveedorTelemetria } from "../dominio/proveedor-telemetria.ts";

// La lectura y el toggle del registro por datos de ProveedorTelemetria (§4.9, §11) [AC-FTEL-06].
//
// «Activar/desactivar la implementación es UPDATE de una fila, cero cambios de código de
// pantalla»: este archivo es ese UPDATE, exactamente. No hay rama por vertical ni por tenant
// acá — la fila de `proveedor_telemetria` es la única fuente de verdad de qué implementación
// está activa, y una pantalla futura que quiera un toggle llama a `activarProveedorTelemetria`
// sin tocar ninguna otra parte del código (§4.6).

export type FilaProveedorTelemetria = {
  codigo: string;
  nombre: string;
  activo: boolean;
};

/** El registro completo, tal como quedó sembrado por la 0077 y modificado por los toggles
 *  posteriores. */
export async function proveedoresTelemetria(c: Pool | PoolClient): Promise<FilaProveedorTelemetria[]> {
  const { rows } = await c.query<FilaProveedorTelemetria>(
    "select codigo, nombre, activo from proveedor_telemetria order by codigo",
  );
  return rows;
}

/** Solo los códigos ACTIVOS, para quien necesita decidir con cuál implementación operar. */
export async function proveedoresTelemetriaActivos(
  c: Pool | PoolClient,
): Promise<CodigoProveedorTelemetria[]> {
  const { rows } = await c.query<{ codigo: string }>(
    "select codigo from proveedor_telemetria where activo order by codigo",
  );
  return rows.map((r) => r.codigo).filter(esCodigoDelRegistro);
}

/** El UPDATE de una fila que activa o desactiva una implementación. El CHECK de la 0077 ya
 *  rechaza cualquier código fuera del registro (23514); acá se valida ANTES para devolver un
 *  error legible en vez de dejar que la excepción de Postgres suba cruda. */
export async function activarProveedorTelemetria(
  c: Pool | PoolClient,
  codigo: string,
  activo: boolean,
): Promise<void> {
  if (!esCodigoDelRegistro(codigo)) {
    throw new Error(`«${codigo}» no pertenece al registro de ProveedorTelemetria (§4.9, §11)`);
  }
  await c.query("update proveedor_telemetria set activo = $2 where codigo = $1", [codigo, activo]);
}
