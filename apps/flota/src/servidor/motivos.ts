import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El catálogo de motivos del tenant [AC-FRUT-13] — §4.5, §4.4, §4.2.
//
// ─── SE APAGAN, JAMÁS SE BORRAN ────────────────────────────────────────────────────
//
// Un motivo es la explicación que quedó escrita en un acto que ya ocurrió. Este archivo no ofrece
// forma de borrar uno, y aunque la ofreciera el trigger de la 0038 la rebotaría: la regla no
// puede depender de que nadie escriba la consulta equivocada un martes.
//
// ─── APAGADO SIGNIFICA «NO SE OFRECE», NO «NO EXISTE» ─────────────────────────────
//
// `listarMotivos` devuelve solo los activos porque es lo que alimenta los flujos NUEVOS. El panel
// que administra el catálogo pide todos: el operador tiene que poder ver lo que apagó para volver
// a encenderlo, y una fila que desaparece de su propia pantalla de administración se lee como un
// dato perdido.
//
// ─── `require_notes` VIAJA, Y NO SE EXIGE ACÁ ─────────────────────────────────────
//
// El §4.2: la validación bloqueante corre en el CLIENTE contra el snapshot y la CAPTURA jamás
// rebota al sincronizar. Este servidor ENTREGA el catálogo con su `require_notes` para que la
// pantalla lo pueda exigir con el camión detenido y la persona ahí. Lo que no hace —ni la base—
// es rebotar una captura que llegue sin nota: el mundo físico ya ocurrió y esa fila es la única
// constancia de que la entrega falló.

export type Motivo = {
  id: string;
  codigo: string;
  etiqueta: string;
  estado_asociado: string;
  require_notes: boolean;
  orden: number;
  activo: boolean;
};

const COLUMNAS = `id::text as id, codigo, etiqueta, estado_asociado, require_notes, orden, activo`;

/** Los que se ofrecen en un flujo nuevo, o TODOS si es el panel el que pregunta. */
export async function listarMotivos(pool: Pool, todos: boolean): Promise<Motivo[]> {
  const { rows } = await pool.query<Motivo>(
    `select ${COLUMNAS} from motivos ${todos ? "" : "where activo"} order by orden, codigo`,
  );
  return rows;
}

/** Copia el catálogo del vertical al tenant (§4.4). Idempotente: la función lo garantiza. */
export async function sembrarMotivos(pool: Pool, vertical: string): Promise<number> {
  const { rows } = await pool.query<{ sembrados: number }>(
    "select sembrar_motivos($1) as sembrados",
    [vertical],
  );
  return rows[0]!.sembrados;
}

export type CambioDeMotivo = { tipo: "ok"; motivo: Motivo } | { tipo: "no_existe" };

/**
 * Apaga o enciende un motivo.
 *
 * Es la ÚNICA forma de sacarlo de la lista, y por eso emite evento: el día que una no-entrega no
 * encuentre su motivo habitual, la auditoría tiene que poder decir quién lo apagó y cuándo.
 */
export async function cambiarMotivo(
  pool: Pool,
  sesion: Sesion,
  motivoId: string,
  activo: boolean,
): Promise<CambioDeMotivo> {
  return enActo(pool, async (c) => {
    const { rows } = await c.query<Motivo>(
      `update motivos set activo = $2 where id = $1 returning ${COLUMNAS}`,
      [motivoId, activo],
    );
    if (!rows[0]) return { tipo: "no_existe" };
    await registrarEvento(c, {
      codigo: activo ? EVENTOS_OPERACION.motivo_encendido : EVENTOS_OPERACION.motivo_apagado,
      objetoTabla: "motivos",
      objetoId: rows[0].id,
      sesion,
      payload: { codigo: rows[0].codigo },
    });
    return { tipo: "ok", motivo: rows[0] };
  });
}
