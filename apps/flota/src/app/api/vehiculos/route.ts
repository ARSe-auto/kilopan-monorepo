import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { listarVehiculos } from "../../../servidor/vehiculos.ts";

// El listado de vehículos del tenant [AC-FVEH-01] — §5.4.
//
// Puerta aparte del alta a propósito. El §5.4 reparte así: el `admin_tenant` da de alta, edita
// y desactiva; el `operador` «solo lee y asigna a rutas». Meter la lectura bajo
// `/api/gobierno/**` le devolvería 403 al operador y le impediría asignar, que es exactamente
// lo que el maestro dice que sí puede hacer. Por eso acá la guardia es la de CUALQUIER sesión
// del tenant, y las mutaciones viven en `/api/gobierno/vehiculos`.
//
// Sin sesión válida: 404 pelado, igual que el resto del panel. Para quien no es de la casa, la
// flota del vecino no existe — ni su tamaño, que ya es información.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ vehiculos: await listarVehiculos(g.acto.pool) });
}
