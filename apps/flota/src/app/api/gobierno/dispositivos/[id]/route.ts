import { headers } from "next/headers";
import { guardia, revocarAparato, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";

// Revocar en 1 TOQUE [AC-FIDN-12] — §5.4 F-F.
//
// Un solo verbo, sin cuerpo y sin confirmación en el servidor: el §5.4 lo cuenta como un
// toque, y un endpoint que pidiera un payload de confirmación convertiría el gesto de
// emergencia —alguien perdió el teléfono en la calle— en dos pantallas.
//
// El efecto es el request siguiente del aparato, no el próximo vencimiento de nada: la sesión
// ES el aparato y se relee en cada request (AC-FIDN-09). Y hacia atrás no se rechaza nada: lo
// que ese teléfono capturó cuando estaba habilitado entra igual, con su flag (centinela 4).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  const hecho = await revocarAparato(g.acto.pool, g.acto.sesion, id);
  if (hecho === null) return noExiste();
  return Response.json({ estado: hecho ? "revocado" : "ya_estaba_revocado" });
}
