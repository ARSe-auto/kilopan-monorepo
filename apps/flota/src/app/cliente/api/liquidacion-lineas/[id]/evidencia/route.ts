import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { evidenciaDeLineaDelCliente } from "../../../../../../servidor/portal-cliente.ts";

// El drill-down línea→evidencia del portal, en 1 clic [AC-FPOR-10] — spec 07 §2.4, spec 06 §9,
// §3.E1.9. Mismo criterio que `/api/liquidacion-lineas/[id]/evidencia` del operador
// (AC-FTAR-07), pero confinado a la empresa de la sesión — la guardia real vive en
// `evidenciaDeLineaDelCliente` (`servidor/portal-cliente.ts`), acá solo el candado de rol y el
// contrato 404/403 del resto del namespace.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es del contratante." },
    { status: 403 },
  );

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const evidencia = await evidenciaDeLineaDelCliente(g.acto.pool, g.acto.sesion, id);
  if (!evidencia) return noExiste();

  return Response.json({ evidencia });
}
