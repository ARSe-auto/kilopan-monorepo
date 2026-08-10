import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { publicarRuta } from "../../../../../servidor/rutas.ts";

// Publicar el día (F1) [AC-FRUT-04] — §5.2-F1, §4.6, §4.9.
//
// El momento ÚNICO de derivación de los `stop_requirement` desde el cargo_type, fijado por la
// sección 1 de la spec 03 (el maestro deriva sin fijar el momento). Acá el día queda congelado:
// desde este clic, lo que el operario ve en cada parada no cambia bajo sus pies.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const publicacion = await publicarRuta(g.acto.pool, g.acto.sesion, id);

  if (publicacion.tipo === "ruta_no_existe") return noExiste();
  if (publicacion.tipo === "ruta_vacia") {
    return Response.json(
      {
        error: "ruta_vacia",
        mensaje: "Esa ruta no tiene ninguna parada todavía. Asignale encargos antes de publicar.",
      },
      { status: 422 },
    );
  }
  if (publicacion.tipo === "ruta_ya_publicada") {
    return Response.json(
      { error: "ruta_ya_publicada", mensaje: "Ese día ya está publicado." },
      { status: 422 },
    );
  }

  return Response.json({ paradas: publicacion.paradas, requisitos: publicacion.requisitos });
}
