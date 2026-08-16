import { headers } from "next/headers";
import { guardia, auditoriaDeAccesos } from "../../../../servidor/gobierno.ts";

// La bitácora de accesos del dueño [AC-FIDN-12] — §3.E1.15, §4.3, §7.9.
//
// Incluye las SESIONES DE SOPORTE, y esa inclusión es la mitad del punto. El begin/end de
// cada acceso de la plataforma se espeja en el `audit_trail` del tenant (AC-FIDN-11) para que
// el dueño no tenga que pedirle a la plataforma el listado de las veces que la plataforma lo
// miró — eso no sería una auditoría, sería un favor. Acá se leen las dos fuentes juntas.
//
// Las dos son append-only (§7.4): esta pantalla no puede mostrar menos de lo que ocurrió ni
// con el rol dueño de la base en la mano.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ accesos: await auditoriaDeAccesos(g.acto.pool) });
}
