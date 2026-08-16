import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { encargosDelCliente } from "../../../../servidor/portal-cliente.ts";

// La lista de encargos propios, para las pantallas «Hoy» y «Encargos» del portal [AC-FPOR-07]
// — spec 07 §2.1, §2.2. Mismo candado que `/cliente/api/encargos/[id]` (AC-FPOR-06): 403 para
// una sesión de la casa, 404 pelado sin sesión — acá no hay id que pueda ser ajeno, así que la
// única fuga posible sería devolver encargos de OTRA empresa, y eso lo cierra el filtro
// `empresa_cliente_id = $1` de `encargosDelCliente`, no un chequeo en esta ruta.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json({ error: "sin_acceso", mensaje: "Este panel es del contratante." }, { status: 403 });

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const encargos = await encargosDelCliente(g.acto.pool, g.acto.sesion);
  return Response.json({ encargos });
}
