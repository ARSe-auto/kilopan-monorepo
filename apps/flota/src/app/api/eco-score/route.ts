import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { puedeVerEcoScore, ecoScoreSemanal } from "../../../servidor/eco-score.ts";
import { AVISO_ECO_SCORE } from "../../../dominio/eco-score.ts";

// Eco-score v1 sin hardware [AC-FTEL-08] — §11 punto 6: admin_tenant y operador, mismo criterio
// de acceso que `/api/torre-de-control` (AC-FTEL-04) — pantalla del gestor, no del terreno.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es de operación o administración." },
    { status: 403 },
  );

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (!puedeVerEcoScore(g.acto.sesion.rol)) return SIN_ACCESO();

  const semanas = await ecoScoreSemanal(g.acto.pool);
  return Response.json({ semanas, aviso: AVISO_ECO_SCORE });
}
