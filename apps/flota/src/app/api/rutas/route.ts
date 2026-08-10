import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../servidor/gobierno.ts";
import { crearRuta, listarRutas } from "../../../servidor/rutas.ts";

// Rutas del día (F1) [AC-FRUT-04] — §5.2-F1, §4.5, §4.2.
//
// PLANIFICACIÓN: se arma con red y antes de que el camión exista, así que acá SÍ se rebota.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const fecha = new URL(peticion.url).searchParams.get("fecha");
  return Response.json({ rutas: await listarRutas(g.acto.pool, fecha) });
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

  const vehiculoId = cuerpo.vehiculo_id ? String(cuerpo.vehiculo_id) : null;
  if (vehiculoId !== null && !esUuid(vehiculoId)) {
    return Response.json(
      { error: "vehiculo_invalido", mensaje: "Ese vehículo no es de tu flota." },
      { status: 422 },
    );
  }

  const ruta = await crearRuta(g.acto.pool, g.acto.sesion, {
    nombre: cuerpo.nombre ? String(cuerpo.nombre) : null,
    vehiculoId,
    fechaServicio: cuerpo.fecha_servicio ? String(cuerpo.fecha_servicio) : null,
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
  });
  return Response.json({ ruta }, { status: 201 });
}
