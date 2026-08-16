import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// Documentos con vencimiento del vehículo [AC-FVEH-03] — §3.E1.3, §4.5, §4.6.
//
// SON DEL DUEÑO. El §5.4 le da al `admin_tenant` «alta, edición de capacidades/documentos y
// desactivación de VEHÍCULOS», así que la puerta vive bajo `/api/gobierno/**` y el barrido de
// AC-FIDN-12 la recoge sola con su 403 y su 404.
//
// EL TIPO NO SE VALIDA CONTRA UNA LISTA, y es deliberado: la **pregunta 2** de la spec 02
// —¿catálogo cerrado de plataforma o filas por tenant?— sigue abierta. Un `includes` contra
// tres cadenas acá respondería «lista cerrada» por el dueño y dejaría a la primera empresa que
// necesite guardar un permiso municipal sin dónde ponerlo.
//
// EL ESTADO SE CALCULA CON EL DÍA DE CHILE y en un solo lugar. `vencido` es `vence_el < hoy`,
// nunca `<=`: una revisión técnica que vence el 30 sirve el 30 entero, y un día de más en el
// rebote es un camión detenido sin motivo. «Por vencer» necesita la anticipación del tenant
// (§4.4); sin ella no existe ese estado, y no se inventa un default [AC-FVEH-17].

export type Documento = {
  id: string;
  vehiculo_id: string;
  tipo: string;
  vence_el: string;
  sha256: string | null;
  estado: "vencido" | "por_vencer" | "vigente";
};

export type AltaDeDocumento =
  | { tipo: "ok"; documento: Documento }
  | { tipo: "vehiculo_no_existe" }
  | { tipo: "tipo_invalido" }
  | { tipo: "fecha_invalida" }
  | { tipo: "sha256_invalido" };

/** El SELECT único. El estado sale de `estado_de_documento()`, que vive en la BASE: la
 *  anticipación de «por vencer» es del tenant (§4.4) y calcularla en cada pantalla serían tres
 *  copias de la misma resta, con el `<=` colándose en una de ellas [AC-FVEH-17]. */
const COLUMNAS = `id::text as id, vehiculo_id::text as vehiculo_id, tipo,
                  to_char(vence_el, 'YYYY-MM-DD') as vence_el, sha256,
                  estado_de_documento(vence_el) as estado`;

const SHA256 = /^[0-9a-f]{64}$/;

export async function cargarDocumento(
  pool: Pool,
  sesion: Sesion,
  vehiculoId: string,
  datos: { tipo: unknown; venceEl: unknown; sha256: unknown },
): Promise<AltaDeDocumento> {
  const tipo = String(datos.tipo ?? "").trim().replace(/\s+/g, " ");
  if (tipo.length === 0 || tipo.length > 60) return { tipo: "tipo_invalido" };

  const venceEl = String(datos.venceEl ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venceEl) || Number.isNaN(new Date(venceEl).getTime())) {
    return { tipo: "fecha_invalida" };
  }

  const sha = datos.sha256 === null || datos.sha256 === undefined ? null : String(datos.sha256);
  // El hash viaja en la mutación ANTES del binario (§4.6): puede no estar todavía, pero si
  // está tiene que ser un sha256 de verdad. Uno truncado se ve como un hash y no compara nada.
  if (sha !== null && !SHA256.test(sha)) return { tipo: "sha256_invalido" };

  return enActo(pool, async (c) => {
    const { rows: vehiculo } = await c.query("select 1 from vehiculos where id = $1", [vehiculoId]);
    if (vehiculo.length === 0) return { tipo: "vehiculo_no_existe" };

    const { rows } = await c.query<Documento>(
      `insert into vehiculo_documentos (vehiculo_id, tipo, vence_el, sha256)
       values ($1, $2, $3::date, $4) returning ${COLUMNAS}`,
      [vehiculoId, tipo, venceEl, sha],
    );
    const documento = rows[0]!;
    await registrarEvento(c, {
      codigo: EVENTOS.documento_cargado,
      objetoTabla: "vehiculo_documentos",
      objetoId: documento.id,
      sesion,
      payload: { vehiculo_id: vehiculoId, tipo, vence_el: venceEl },
    });
    return { tipo: "ok", documento };
  });
}

/** Los documentos de un vehículo, del que vence primero al que vence último. */
export async function listarDocumentos(pool: Pool, vehiculoId: string): Promise<Documento[]> {
  const { rows } = await pool.query<Documento>(
    `select ${COLUMNAS} from vehiculo_documentos where vehiculo_id = $1 order by vence_el`,
    [vehiculoId],
  );
  return rows;
}

/** Los documentos de TODA la flota, para que la lista de vehículos muestre su estado sin
 *  pedir uno por uno — que con veinte camiones son veinte requests desde un teléfono. */
export async function documentosDeLaFlota(pool: Pool): Promise<Documento[]> {
  const { rows } = await pool.query<Documento>(
    `select ${COLUMNAS} from vehiculo_documentos order by vehiculo_id, vence_el`,
  );
  return rows;
}
