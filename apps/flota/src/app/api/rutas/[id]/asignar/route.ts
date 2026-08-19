import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { asignarEncargos } from "../../../../../servidor/rutas.ts";

// Asignación múltiple de encargos a una ruta (F1) [AC-FRUT-04] — §3.E1.5, §5.2-F1.
//
// Múltiple de verdad: el operador marca los encargos del destino y los manda en UNA acción. Uno
// por uno serían veinte clics para una ruta de pan, y el presupuesto del §5.3 son quince para el
// día ENTERO.
//
// Los que caen al mismo destino se agrupan en una sola parada de entrega; el desglose por
// empresa queda en los ítems (§3.E1.5).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const encargos = Array.isArray(cuerpo.encargos) ? cuerpo.encargos.map(String) : [];
  if (encargos.length === 0 || !encargos.every(esUuid)) {
    return Response.json(
      { error: "faltan_encargos", mensaje: "Elegí al menos un encargo para asignar a la ruta." },
      { status: 422 },
    );
  }

  // La ventana comprometida es OPCIONAL: donde no la haya, al publicar no se congela ninguna
  // promesa — que es lo correcto, porque no se prometió nada (§4.5).
  const v = cuerpo.ventana as { desde?: string; hasta?: string } | undefined;
  const ventana = v?.desde && v?.hasta ? { desde: String(v.desde), hasta: String(v.hasta) } : null;

  const asignacion = await asignarEncargos(g.acto.pool, g.acto.sesion, id, encargos, ventana);

  if (asignacion.tipo === "ruta_no_existe") return noExiste();
  if (asignacion.tipo === "encargo_no_existe") {
    return Response.json(
      {
        error: "encargo_no_existe",
        mensaje: "Uno de los encargos ya no está en la bandeja. Actualizá la lista y volvé a intentar.",
      },
      { status: 422 },
    );
  }
  if (asignacion.tipo === "ruta_ya_publicada") {
    return Response.json(
      {
        error: "ruta_ya_publicada",
        mensaje: "Ese día ya está publicado. Para cambiarlo hay que armar una versión nueva.",
      },
      { status: 422 },
    );
  }

  return Response.json({
    paradas: asignacion.paradas,
    items: asignacion.items,
    repetidos: asignacion.repetidos,
  });
}
