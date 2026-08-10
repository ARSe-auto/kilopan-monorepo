import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../servidor/gobierno.ts";
import { listarMaestras, instanciarDesdeMaestra } from "../../../servidor/rutas.ts";

// Rutas maestras (F1) [AC-FRUT-06] — §3.E1.6, §4.5.
//
// El POST instancia el DÍA a partir de una plantilla: la ruta nueva nace con origen `maestra` y
// su propia versión, y la maestra queda intacta. Que sea una copia y no una referencia es la
// pregunta 2 de la spec 03, declarada en `servidor/rutas.ts`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ maestras: await listarMaestras(g.acto.pool, g.acto.sesion) });
}

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const maestraId = String(cuerpo.maestra_id ?? "");
  if (!esUuid(maestraId)) {
    return Response.json(
      { error: "falta_maestra", mensaje: "Elegí la ruta maestra de la que sale el día." },
      { status: 422 },
    );
  }

  const hecha = await instanciarDesdeMaestra(g.acto.pool, g.acto.sesion, maestraId, {
    vehiculoId: cuerpo.vehiculo_id ? String(cuerpo.vehiculo_id) : null,
    fechaServicio: cuerpo.fecha_servicio ? String(cuerpo.fecha_servicio) : null,
  });

  if (hecha.tipo === "maestra_no_existe") return new Response(null, { status: 404 });
  if (hecha.tipo === "no_es_maestra") {
    return Response.json(
      {
        error: "no_es_maestra",
        mensaje: "Esa es una ruta de un día, no una plantilla. Elegí una ruta maestra.",
      },
      { status: 422 },
    );
  }
  return Response.json({ ruta: hecha.ruta, paradas: hecha.paradas }, { status: 201 });
}
