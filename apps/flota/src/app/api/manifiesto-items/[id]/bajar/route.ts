import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { bajarDelManifiesto } from "../../../../../servidor/manifiestos.ts";

// «Bajar del manifiesto» [AC-FRUT-08] — §7.3, §5.2 F2.
//
// La vía EXPLÍCITA para la carga sin documento. Jamás un override silencioso: el motivo es
// obligatorio, queda su evento y queda su auditoría.
//
// Existe porque sin ella el operario con un camión que sale a las cinco encuentra la salida por
// su cuenta —confirma con un folio inventado— y ahí sí la app produjo un dato falso. Con ella la
// mercadería se baja, queda escrito quién lo hizo y por qué, y el camión sale legal.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const bajado = await bajarDelManifiesto(
    g.acto.pool,
    g.acto.sesion,
    id,
    String(cuerpo.motivo ?? ""),
  );

  if (bajado.tipo === "item_no_existe") return noExiste();
  if (bajado.tipo === "falta_motivo") {
    return Response.json(
      {
        error: "falta_motivo",
        mensaje: "Escribí por qué se baja esta carga. Queda en el registro y alguien lo va a leer mañana.",
      },
      { status: 422 },
    );
  }
  return Response.json({ bajado: true });
}
