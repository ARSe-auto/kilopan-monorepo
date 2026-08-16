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

  const publicacion = await publicarRuta(g.acto.pool, g.acto.sesion, g.acto.slug, id);

  if (publicacion.tipo === "ruta_no_existe") return noExiste();

  // Cada rebote dice QUÉ arreglar y DÓNDE. Un «no se pudo publicar» para los cinco dejaría al
  // operador probando a ciegas a las cinco de la mañana (§5.7).
  const REBOTES: Record<string, string> = {
    ruta_vacia: "Esa ruta no tiene ninguna parada todavía. Asignale encargos antes de publicar.",
    ruta_ya_publicada: "Ese día ya está publicado.",
    ruta_sin_vehiculo: "Elegí el vehículo que va a hacer esta ruta antes de publicarla.",
    documento_vencido:
      "Ese vehículo tiene un documento vencido. Actualizalo en su ficha y volvé a publicar.",
    certificacion_vencida:
      "Ese vehículo tiene una certificación vencida. Renovala en su ficha y volvé a publicar.",
    agenda_solapada:
      "Ese vehículo ya tiene algo agendado en ese horario. Mirá su agenda y elegí otro camión o corregí las ventanas.",
  };
  if (publicacion.tipo !== "ok") {
    return Response.json(
      { error: publicacion.tipo, mensaje: REBOTES[publicacion.tipo] },
      { status: 422 },
    );
  }

  return Response.json({
    paradas: publicacion.paradas,
    requisitos: publicacion.requisitos,
    promesas: publicacion.promesas,
  });
}
