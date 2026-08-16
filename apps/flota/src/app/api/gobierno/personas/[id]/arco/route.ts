import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { exportarArco } from "../../../../../../servidor/arco.ts";

// Export ARCO por persona [AC-FIDN-15] — §3.E1.15, §7.8, Ley 21.719.
//
// POST Y NO GET, y no es una preferencia de estilo: este endpoint ESCRIBE el acto de gobierno
// que registra el acceso (§3.E1.15). Un GET sería cacheable, prefetcheable por el navegador y
// repetible desde el historial — o sea, la bitácora se llenaría de accesos que nadie hizo, que
// es la otra forma de que una bitácora mienta sin que nadie mienta.
//
// SOLO EL DUEÑO, sin autoservicio: lo dictó Alexis el 11-ago-2026 (Pregunta 8). El trabajador
// pide su export por fuera de la app y el dueño lo genera. `guardia()` ya es esa regla — 404
// para quien no es de la casa, 403 para quien está adentro con otro rol.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  const salida = await exportarArco(g.acto.pool, g.acto.sesion, id, g.acto.slug);
  if (salida === null) return noExiste();

  // JSON indentado y no compacto: el documento se le entrega a una persona que puede querer
  // leerlo, no solo a un programa (Pregunta 8 — «JSON estructurado, completo y auditable»).
  return new Response(JSON.stringify(salida.documento, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Los datos personales de una persona no se guardan en ninguna caché del camino.
      "cache-control": "no-store",
    },
  });
}
