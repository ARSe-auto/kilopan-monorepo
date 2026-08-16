import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { liquidacionesDelCliente } from "../../../../servidor/portal-cliente.ts";

// La lista de liquidaciones propias (cabecera, sin líneas), para la pantalla «Liquidación» del
// portal [AC-FPOR-07] — spec 07 §2.4. Mismo candado que `/cliente/api/liquidaciones/[id]`
// (AC-FPOR-06): 403 para una sesión de la casa, 404 pelado sin sesión. El drill-down a líneas y
// evidencia sigue siendo `/cliente/api/liquidaciones/[id]` (con sus líneas) y
// `/cliente/api/evidencias/[id]` — esta ruta solo lista, no abre ninguna.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json({ error: "sin_acceso", mensaje: "Este panel es del contratante." }, { status: 403 });

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const liquidaciones = await liquidacionesDelCliente(g.acto.pool, g.acto.sesion);
  return Response.json({ liquidaciones });
}
