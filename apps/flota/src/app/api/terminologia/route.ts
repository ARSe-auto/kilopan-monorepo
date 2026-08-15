import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { terminologiaDelTenant } from "../../../servidor/terminologia.ts";

// El catálogo de terminología ya resuelto del tenant vigente [AC-FMIG-04] — §5.1. Lo consume
// el panel `/panel/terminologia` y, más adelante, cualquier pantalla de terreno que renderice
// un `<Termino>` (packages/miga) del lado del cliente.
//
// Sin parámetro de ruta: el tenant sale de `x-flota-tenant-bd`, igual que `/api/tema`. Sin esa
// cabecera no se adivina nada — 404, como el resto de las puertas de este ruteo.
//
// SIN chequeo de rol: la restricción de quién puede EDITAR terminología es de AC-FMIG-06 (hoy
// bloqueado por la Pregunta al dueño n.º 11, que la spec deja explícitamente sin cerrar) — este
// AC solo lee, y leer el catálogo resuelto del propio tenant no es una superficie que necesite
// blindaje por rol (mismo criterio que `GET /api/tema`).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  const terminos = await terminologiaDelTenant(poolDe(bd));
  return Response.json({ terminos });
}
