import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import { cambiarDefecto, ESTADOS_DE_DEFECTO } from "../../../../servidor/chequeos.ts";

// El ciclo del defecto [AC-FVEH-04] — §4.5, §6 (patrón Fleetio), §7.6.
//
// abierto → en curso → resuelto, más el `bloqueante` que marca el OPERADOR. Es PLANIFICACIÓN y
// rebota: lo hace alguien sentado con red, no una persona de pie al lado de un camión.
//
// RESOLVER EXIGE NOTA. Un defecto que se cierra sin decir cómo es un defecto que vuelve a
// aparecer sin que nadie sepa qué se probó la vez anterior — la misma regla que `review_queue`
// del §5.6, y la base la sostiene con su propio CHECK.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: { estado?: unknown; bloqueante?: unknown; nota?: unknown };
  try {
    cuerpo = (await peticion.json()) as { estado?: unknown; bloqueante?: unknown; nota?: unknown };
  } catch {
    cuerpo = {};
  }

  const cambio = await cambiarDefecto(g.acto.pool, g.acto.sesion, id, {
    estado: cuerpo.estado === undefined ? undefined : String(cuerpo.estado),
    bloqueante: typeof cuerpo.bloqueante === "boolean" ? cuerpo.bloqueante : undefined,
    nota: cuerpo.nota === undefined ? undefined : String(cuerpo.nota),
  });

  if (cambio.tipo === "no_existe") return noExiste();
  if (cambio.tipo === "estado_invalido") {
    return Response.json(
      { error: "estado_invalido", mensaje: "Ese no es un estado de un defecto.", estados: ESTADOS_DE_DEFECTO },
      { status: 422 },
    );
  }
  if (cambio.tipo === "resolucion_sin_nota") {
    return Response.json(
      {
        error: "resolucion_sin_nota",
        mensaje: "Para cerrar un defecto hay que decir cómo se resolvió: sin eso vuelve a aparecer y nadie sabe qué se probó.",
      },
      { status: 422 },
    );
  }
  return Response.json({ estado: cambio.estado, bloqueante: cambio.bloqueante });
}
