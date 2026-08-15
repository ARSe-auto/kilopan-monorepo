import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { evidenciaDelCliente } from "../../../../../servidor/portal-cliente.ts";

// Una evidencia (`evidence`, §4.6) propia, dentro del namespace del portal [AC-FPOR-06] — spec
// 07 §2, §9.3 centinela 3. `evidence` no tiene columna de empresa propia: la confina el JOIN
// contra `paradas` dentro de `servidor/portal-cliente.ts`, cuya RLS (0040) sí la tiene. Mismas
// tres respuestas que el resto del namespace.
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

  const evidencia = await evidenciaDelCliente(g.acto.pool, g.acto.sesion, id);
  if (!evidencia) return noExiste();

  return Response.json({ evidencia });
}
