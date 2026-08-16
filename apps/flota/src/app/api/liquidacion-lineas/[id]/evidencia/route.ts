import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { evidenciaDeLinea, puedeVerLiquidaciones } from "../../../../../servidor/liquidaciones.ts";

// El drill-down línea→evidencia en 1 clic [AC-FTAR-07] — spec 06 §9, §3.E1.9. Misma guardia
// que `/api/liquidaciones/[id]`: 404 sin sesión o con id de otro tenant, 403 con un rol que no
// es de este panel.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es de operación o administración." },
    { status: 403 },
  );

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (!puedeVerLiquidaciones(g.acto.sesion.rol)) return SIN_ACCESO();

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const evidencia = await evidenciaDeLinea(g.acto.pool, g.acto.sesion, id);
  if (!evidencia) return noExiste();

  return Response.json({ evidencia });
}
