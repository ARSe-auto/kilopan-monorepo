import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { liquidacionDelCliente } from "../../../../../servidor/portal-cliente.ts";

// La liquidación propia, con sus líneas, dentro del namespace del portal [AC-FPOR-06] — spec
// 07 §2, §9.3 centinela 3. Lee SOLO `liquidacion_cliente`/`liquidacion_lineas_cliente` (0067),
// jamás `liquidaciones`/`liquidacion_lineas` en crudo — es la vía sancionada del §4.3. Mismas
// tres respuestas que `/cliente/api/encargos/[id]`: 403 con rol de la casa, 404 sin sesión o
// con id que no existe o es de otra empresa.
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

  const liquidacion = await liquidacionDelCliente(g.acto.pool, g.acto.sesion, id);
  if (!liquidacion) return noExiste();

  return Response.json({ liquidacion });
}
