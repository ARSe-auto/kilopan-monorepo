import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";

// Los destinos del tenant [AC-FRUT-01] — §4.5.
//
// Solo lectura por ahora: el alta con geocoding y confirmación del pin es del hito (d) más
// adelante y de E2, y este AC no la adelanta.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { rows } = await g.acto.pool.query(
    "select id::text as id, nombre from destinos order by nombre",
  );
  return Response.json({ destinos: rows });
}
