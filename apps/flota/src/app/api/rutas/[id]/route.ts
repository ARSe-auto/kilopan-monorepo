import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import { verRuta } from "../../../../servidor/rutas.ts";

// La ruta armada, con sus paradas y el desglose por empresa de cada una [AC-FRUT-04].
//
// Un id de otro tenant —o mal formado— da 404 y nada más: lo que no dice es el punto (§9.3.2).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const armada = await verRuta(g.acto.pool, id);
  if (!armada) return noExiste();
  return Response.json(armada);
}
