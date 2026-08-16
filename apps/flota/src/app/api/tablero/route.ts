import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { tablero } from "../../../servidor/tablero.ts";

// El tablero «Listos para salir» (F1) [AC-FVEH-12] — §5.2-F1, §3.E1.12.
//
// Es del OPERADOR (§5.2-F1 lo pone en la web del operador), así que basta con una sesión del
// tenant: no es un acto de gobierno. La lectura no expone montos, así que tampoco toca la RLS
// de dinero del §4.8.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ flota: await tablero(g.acto.pool) });
}
