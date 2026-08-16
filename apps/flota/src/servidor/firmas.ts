import type { Pool } from "pg";
import { verificarPin } from "./pin.ts";
import { clasificar, flagDe } from "../dominio/revocacion.ts";

// La firma puntual por PIN [AC-FIDN-10] — §4.3, centinela 12 del §9.3.
//
// EL CASO QUE ESTO RESUELVE. En la parada, el chofer tiene que firmar «recibí conforme» y el
// aparato que hay a mano es el del responsable de carga. Firmar tiene que poder hacerse ahí, en
// el momento, sin que el chofer tenga que enrolarse ni que el responsable cierre su sesión.
//
// Y EL RIESGO QUE TRAE, que es el centinela 12: si esa firma abriera sesión, o desplazara la
// del titular del aparato, el responsable quedaría afuera de su propio teléfono a mitad de un
// turno — o peor, seguiría trabajando creyendo que es él mientras el sistema cree que es otro,
// y sus PODs posteriores quedarían firmados por la persona equivocada. Por eso esta función
// devuelve una FIRMA y nada más: no emite credencial, no toca `dispositivos`, no tiene por
// dónde cambiar quién está autenticado. La sesión del §4.3 es el secreto del aparato
// (AC-FIDN-09) y acá no se mira ni se escribe.
//
// La firma es CAPTURA (§4.2): ocurre en terreno y JAMÁS rebota al sincronizar. La única
// excepción es el PIN equivocado, que no es un rebote de sincronización sino la comprobación
// de quién firma — sin ella la firma no significaría nada.

export type Firma = {
  personaId: string;
  dispositivoId: string;
  objetoTabla: string;
  objetoId: string;
  significado: string;
  clientUuid?: string;
};

export type ResultadoFirma =
  | { tipo: "firmada"; firmaId: string; flag: string | null }
  | { tipo: "rebote"; motivo: "credenciales_invalidas" | "bloqueado" };

/**
 * Firma en el aparato que haya a mano. `usuarioId` es quien FIRMA y `dispositivoId` el aparato
 * donde lo hace: pueden pertenecer a personas distintas, y ese es el caso normal.
 *
 * `recibidaEn` existe para la firma que llega por sync de un aparato ya revocado: entra igual
 * —2xx— con el flag de AC-FIDN-09, porque el §4.2 dice que la captura no rebota y una firma
 * hecha cuando el aparato estaba habilitado no deja de haber ocurrido porque después lo dieran
 * de baja.
 */
export async function firmarConPin(
  pool: Pool,
  datos: Firma & { usuarioId: string; pin: string; recibidaEn?: Date },
): Promise<ResultadoFirma> {
  const veredicto = await verificarPin(pool, datos.usuarioId, datos.pin);
  if (veredicto.tipo === "bloqueado") return { tipo: "rebote", motivo: "bloqueado" };
  if (veredicto.tipo !== "correcto") return { tipo: "rebote", motivo: "credenciales_invalidas" };

  const { rows: aparato } = await pool.query<{ revocado_at: Date | null }>(
    "select revocado_at from dispositivos where id = $1",
    [datos.dispositivoId],
  );
  const clase = clasificar(aparato[0]?.revocado_at ?? null, datos.recibidaEn ?? new Date());
  const flag = flagDe(clase);

  const { rows } = await pool.query<{ id: string }>(
    `insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado, client_uuid)
     values ($1, $2, $3, $4, $5::significado_firma, $6)
     on conflict (tenant_id, client_uuid) do nothing
     returning id::text as id`,
    [
      datos.personaId,
      datos.dispositivoId,
      datos.objetoTabla,
      datos.objetoId,
      datos.significado,
      datos.clientUuid ?? null,
    ],
  );

  // Sin fila devuelta, el replay encontró la firma ya escrita (§0, centinela 1): se busca la
  // que quedó. Devolver «no pasó nada» sería mentirle al aparato, que necesita saber que su
  // firma está.
  if (!rows[0]) {
    const { rows: existente } = await pool.query<{ id: string }>(
      "select id::text as id from firmas where client_uuid = $1",
      [datos.clientUuid ?? null],
    );
    return { tipo: "firmada", firmaId: existente[0]!.id, flag };
  }

  return { tipo: "firmada", firmaId: rows[0].id, flag };
}
