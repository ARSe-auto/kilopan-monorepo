import { headers } from "next/headers";
import { guardia, listarSolicitudes } from "../../../../servidor/gobierno.ts";

// Las solicitudes esperando decisión [AC-FIDN-12] — §5.4 F-C.
//
// De acá sale el BADGE del panel de enrolamiento, y de ningún otro lado: la Pregunta 6 la
// respondió Alexis el 09-ago-2026 y dice que el semáforo «Hoy» NO lleva esta señal. El
// semáforo es de la operación y tiene un tope de tarjetas fijado por el §0; meterle enrolamiento le
// saca el lugar a algo que sí detiene un camión, y el día que entran cinco personas tapa el
// tablero entero.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const pendientes = await listarSolicitudes(g.acto.pool);
  return Response.json({ pendientes, total: pendientes.length });
}
