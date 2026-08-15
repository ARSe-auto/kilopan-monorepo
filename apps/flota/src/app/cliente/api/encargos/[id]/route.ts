import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { encargoDelCliente } from "../../../../../servidor/portal-cliente.ts";

// El encargo propio, dentro del namespace del portal [AC-FPOR-06] — spec 07 §2, §9.3
// centinela 3. Rol distinto de `cliente` (sesión válida, pero de la casa): 403 — es de la
// misma familia que `SIN_ACCESO` en `/api/liquidaciones/[id]`, aplicado acá porque este panel
// es EXCLUSIVO del contratante. Sin sesión, o encargo que no existe, o de otra empresa (RLS de
// `encargos`, 0040): 404 pelado — las tres se ven igual (§0, centinela 2).
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

  const encargo = await encargoDelCliente(g.acto.pool, g.acto.sesion, id);
  if (!encargo) return noExiste();

  return Response.json({ encargo });
}
