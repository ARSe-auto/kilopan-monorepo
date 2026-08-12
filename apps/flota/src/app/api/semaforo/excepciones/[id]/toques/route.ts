import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { registrarToquesDrillDown } from "../../../../../../servidor/review-queue.ts";

// Detalle N2 — telemetría de toques [AC-FSEM-05] — spec 05 §2.3, §5, §2.4, §2.8.
//
// «Rojo→detalle ≤2 toques desde «Hoy»», e2e que cuenta acciones y emite `toques_flujo` a
// `client_metric` (§5.3, §4.6). Misma guardia que reconocer/resolver (§2.8: el tablero es
// SOLO `admin_tenant`): sin sesión ⇒ 404 pelado, rol distinto ⇒ 403, excepción de otro
// tenant ⇒ 404 por construcción (la fila de B no está en la base que el ruteo eligió).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let toques = 0;
  try {
    const cuerpo = (await peticion.json()) as { toques?: unknown };
    if (typeof cuerpo.toques === "number") toques = cuerpo.toques;
  } catch {
    // Cuerpo ausente o mal formado se trata igual que 0 toques: el 422 de abajo lo explica.
  }
  if (!Number.isInteger(toques) || toques < 1) {
    return Response.json(
      { error: "toques_invalidos", mensaje: "El conteo de toques debe ser un entero ≥ 1." },
      { status: 422 },
    );
  }

  const resultado = await registrarToquesDrillDown(g.acto.pool, g.acto.sesion, id, toques);
  if (resultado === "no_existe") return noExiste();
  return Response.json({ id, registrado: true, toques });
}
