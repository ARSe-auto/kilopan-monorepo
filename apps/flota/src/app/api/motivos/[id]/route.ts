import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import { cambiarMotivo } from "../../../../servidor/motivos.ts";

// Apagar o encender un motivo [AC-FRUT-13] — §4.5.
//
// NO hay DELETE, y no es un olvido: un motivo es la explicación que quedó escrita en un acto que
// ya ocurrió. Borrarlo dejaría sin sentido todas las no-entregas que lo referencian — las mismas
// que sostienen la disputa cuando el cliente reclama. Si alguien lo intentara por otra vía, el
// trigger de la 0038 lo rebota.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const cambio = await cambiarMotivo(g.acto.pool, g.acto.sesion, id, cuerpo.activo === true);
  if (cambio.tipo === "no_existe") return noExiste();
  return Response.json({ motivo: cambio.motivo });
}
