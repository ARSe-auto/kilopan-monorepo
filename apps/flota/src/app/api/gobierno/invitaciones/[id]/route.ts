import { headers } from "next/headers";
import { guardia, cambiarInvitacion, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";

// Pausar, reanudar y revocar una invitación [AC-FIDN-12] — §5.4 F-A.
//
// LA RUTA CON PARÁMETRO. Es la primera del producto que nombra un recurso, y por eso es la
// primera que el centinela 2 del §9.3 puede ejercer de verdad: pedirla con el id de OTRO
// tenant tiene que dar 404 pelado. Sale por construcción —la consulta corre contra la base
// que el ruteo eligió y el id de B no está ahí— y no por una rama que lo contemple.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCIONES = ["pausar", "reanudar", "revocar"] as const;
type Accion = (typeof ACCIONES)[number];

export async function PATCH(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: { accion?: unknown };
  try {
    cuerpo = (await peticion.json()) as { accion?: unknown };
  } catch {
    cuerpo = {};
  }
  const accion = String(cuerpo.accion ?? "");
  if (!ACCIONES.includes(accion as Accion)) {
    return Response.json(
      { error: "accion_desconocida", mensaje: "Acción no válida sobre la invitación.", acciones: ACCIONES },
      { status: 422 },
    );
  }

  const hecho = await cambiarInvitacion(g.acto.pool, g.acto.sesion, id, accion as Accion);
  // `null` = no está en esta base. Es el mismo 404 que da un id inventado y que da el id de
  // otro tenant: las tres situaciones tienen que verse iguales o la respuesta es un oráculo.
  if (hecho === null) return noExiste();
  // `false` = está, pero ya estaba así. No es un error: reaccionar dos veces al mismo botón
  // en un galpón con guantes es lo normal, y un 422 ahí sería castigar el doble toque.
  return Response.json({ estado: hecho ? "aplicada" : "sin_cambios", accion });
}
