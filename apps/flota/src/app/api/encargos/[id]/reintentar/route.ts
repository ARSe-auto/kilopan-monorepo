import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { reintentarEncargo } from "../../../../../servidor/encargos.ts";

// Reintentar = encargo NUEVO con `reintento_de` [AC-FRUT-03] — §4.5, §6.
//
// El original no se reabre: salió en un camión y no entregó, y ese es el dato de la disputa.
// Quedan dos filas encadenadas, con la historia completa.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const reintento = await reintentarEncargo(
    g.acto.pool,
    g.acto.sesion,
    id,
    cuerpo.fecha_servicio ? String(cuerpo.fecha_servicio) : null,
  );
  if (reintento.tipo === "no_existe") return noExiste();
  if (reintento.tipo === "no_fue_un_fracaso") {
    return Response.json(
      {
        error: "no_fue_un_fracaso",
        mensaje:
          "Reintentar es para lo que salió y no se entregó. Este encargo todavía está en curso.",
        estado: reintento.estado,
      },
      { status: 422 },
    );
  }
  return Response.json({ encargo: reintento.encargo }, { status: reintento.repetido ? 200 : 201 });
}
