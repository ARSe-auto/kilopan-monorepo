import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { motivosDeDisputa } from "../../../../servidor/portal-cliente.ts";

// El catálogo de motivos de disputa del portal [AC-FPOR-10] — spec 07 §2.4, spec 06 §6. Solo
// los del catálogo `liquidacion_linea_disputada` (0066) — jamás el catálogo de no-entrega del
// terreno, que es de otro flujo y el §3.E1.10 prohíbe mostrarle al contratante.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es del contratante." },
    { status: 403 },
  );

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const motivos = await motivosDeDisputa(g.acto.pool, g.acto.sesion);
  return Response.json({ motivos });
}
