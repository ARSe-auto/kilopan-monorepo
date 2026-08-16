import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import { corregirTraspaso } from "../../../../servidor/manifiestos.ts";

// Corregir un traspaso de custodia [AC-FRUT-09] — centinela 6, §7.4.
//
// NO hay PATCH ni DELETE, y no es un olvido: la corrección es un SUPERSEDE. Quedan DOS filas y
// la original intacta. Es la diferencia entre una corrección auditable y una que nadie puede
// distinguir de un encubrimiento — si la primera desapareciera, nada probaría que alguna vez
// dijo otra cosa.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
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

  const corregido = await corregirTraspaso(g.acto.pool, g.acto.sesion, {
    custodyTransferId: id,
    motivo: String(cuerpo.motivo ?? ""),
    sello: cuerpo.sello ? String(cuerpo.sello) : null,
  });

  if (corregido.tipo === "no_existe") return noExiste();
  if (corregido.tipo === "falta_motivo") {
    return Response.json(
      {
        error: "falta_motivo",
        mensaje: "Escribí por qué se corrige. Queda en el registro junto a la versión anterior.",
      },
      { status: 422 },
    );
  }
  return Response.json(corregido, { status: 201 });
}
