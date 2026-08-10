import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { reordenarParadas } from "../../../../../servidor/rutas.ts";

// Reordenar las paradas de una ruta [AC-FRUT-06] — §3.E1.6, §5.7.
//
// UN endpoint para los DOS gestos: el arrastre del escritorio y los botones de subir/bajar del
// móvil. El §3.E1.6 pide drag & drop solo en escritorio, y si el móvil no tuviera ninguna otra
// vía «sin drag & drop» sería «sin poder reordenar» — pérdida de datos por omisión.
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

  const enOrden = Array.isArray(cuerpo.paradas) ? cuerpo.paradas.map(String) : [];
  if (enOrden.length === 0 || !enOrden.every(esUuid)) {
    return Response.json(
      { error: "faltan_paradas", mensaje: "Mandá las paradas en el orden que tienen que quedar." },
      { status: 422 },
    );
  }

  const hecho = await reordenarParadas(g.acto.pool, id, enOrden);
  if (hecho.tipo === "ruta_no_existe") return noExiste();
  return Response.json({ paradas: hecho.paradas });
}
