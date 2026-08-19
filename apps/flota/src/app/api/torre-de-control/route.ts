import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { puedeVerTorreDeControl, vehiculosEnRuta } from "../../../servidor/torre-de-control.ts";

// La torre de control del gestor [AC-FTEL-04] — §5.7, §11: última posición conocida por
// vehículo EN RUTA, con la antigüedad honesta del dato. Mismo criterio de acceso que
// `/api/liquidaciones/[id]` (AC-FTAR-07): admin_tenant y operador, nadie más — el §4.3 (y
// AC-FTEL-05) excluyen de frente al `cliente` de este mapa.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es de operación o administración." },
    { status: 403 },
  );

export async function GET(_peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (!puedeVerTorreDeControl(g.acto.sesion.rol)) return SIN_ACCESO();

  const vehiculos = await vehiculosEnRuta(g.acto.pool, new Date());
  return Response.json({ vehiculos });
}
