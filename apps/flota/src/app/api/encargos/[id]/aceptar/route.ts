import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { aceptarEncargo } from "../../../../../servidor/encargos.ts";

// `solicitado → aceptado` [AC-FRUT-03] — §3.E1.10, §4.5.
//
// El único paso de la máquina que estampa la app: es un acto humano del operador y no se deriva
// de ningún hecho de terreno. Y es el que CIERRA la ventana de edición del contratante.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  const aceptacion = await aceptarEncargo(g.acto.pool, g.acto.sesion, id);
  if (aceptacion.tipo === "no_existe") return noExiste();
  if (aceptacion.tipo === "no_estaba_solicitado") {
    return Response.json(
      {
        error: "no_estaba_solicitado",
        mensaje: "Este encargo ya estaba aceptado: no hace falta aceptarlo de nuevo.",
        estado: aceptacion.estado,
      },
      { status: 422 },
    );
  }
  return Response.json({ encargo: aceptacion.encargo });
}
