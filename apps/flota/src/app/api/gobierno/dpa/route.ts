import { headers } from "next/headers";
import { guardia } from "../../../../servidor/gobierno.ts";
import { obtenerEstadoDpa, aceptarDpa } from "../../../../servidor/dpa.ts";

// El DPA en términos del tenant, por HTTP [AC-FMIG-22] — §3.E1.15, §7.8, §5.4.
//
// Vive bajo `/api/gobierno/**` con esas palabras exactas, igual que `funciones` (AC-FMIG-08):
// el barrido de AC-FIDN-12 (`e2e/gobierno.spec.ts`) recoge esta ruta sola y ya prueba sin
// sesión ⇒ 404 pelado y rol distinto de `admin_tenant` ⇒ 403 con CERO filas — exactamente el
// rebote que el texto del AC pide («con rol distinto de `admin_tenant` ⇒ 403 y 0 filas»). Lo
// que este archivo prueba de más, en `e2e/dpa.spec.ts`, es lo que el barrido genérico no puede:
// que la aceptación escriba `audit_trail` con la versión aceptada y que sea idempotente.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json(await obtenerEstadoDpa(g.acto.pool));
}

export async function POST() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { yaAceptada, aceptadoEn } = await aceptarDpa(g.acto);
  return Response.json({ aceptado: true, yaAceptada, aceptadoEn });
}
