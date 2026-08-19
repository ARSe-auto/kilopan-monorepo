import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { registrarToquesDeCampo } from "../../../../servidor/metricas.ts";

// AC-FMIG-03 — toques-hasta-completar por campo del teclado propio (§5.3, §4.6): a diferencia
// del N2 del semáforo (AC-FSEM-05, SOLO admin_tenant), acá reporta CUALQUIER sesión válida del
// tenant — el campo lo completa el chofer o el responsable de carga en terreno, no el dueño.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whitelist cerrada: el `flujo` viaja desde el cliente, y un valor libre convertiría la
// telemetría de producto en una bolsa de strings arbitrarios. Cada entrada corresponde a un
// campo real instrumentado con `useContadorDeToques` (cliente/toques-flujo.ts).
const FLUJOS_VALIDOS = new Set(["carga_pin", "turno_abrir_odometro", "turno_abrir_soc", "entrega_cantidad_parcial"]);

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let flujo = "";
  let toques = 0;
  try {
    const cuerpo = (await peticion.json()) as { flujo?: unknown; toques?: unknown };
    if (typeof cuerpo.flujo === "string") flujo = cuerpo.flujo;
    if (typeof cuerpo.toques === "number") toques = cuerpo.toques;
  } catch {
    // Cuerpo ausente o mal formado se trata igual que valores inválidos: el 422 de abajo lo explica.
  }
  if (!FLUJOS_VALIDOS.has(flujo) || !Number.isInteger(toques) || toques < 1) {
    return Response.json(
      { error: "toques_invalidos", mensaje: "El flujo y el conteo de toques deben ser válidos." },
      { status: 422 },
    );
  }

  await registrarToquesDeCampo(g.acto.pool, g.acto.sesion, flujo, toques);
  return Response.json({ registrado: true, flujo, toques });
}
