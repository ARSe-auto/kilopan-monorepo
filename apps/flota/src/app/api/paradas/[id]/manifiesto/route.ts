import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { loDeclaradoEn, confirmarManifiesto } from "../../../../../servidor/manifiestos.ts";

// El sub-manifiesto del andén (F2) [AC-FRUT-07] — §5.2 F2, §4.2, §4.7.
//
// ES CAPTURA: el POST no rebota NUNCA. Cuando llega, el camión ya se cargó — un rechazo no
// impide nada y borra la única constancia de lo que pasó en el andén a las cuatro de la mañana.
// Lo único que "falla" es el replay, y eso no es un fallo: es la misma captura llegando dos
// veces, y se contesta con la fila que ya existe (§9.3.1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  return Response.json({ declarado: await loDeclaradoEn(g.acto.pool, g.acto.sesion, id) });
}

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

  const empresaClienteId = String(cuerpo.empresa_cliente_id ?? "");
  if (!esUuid(empresaClienteId)) return noExiste();

  const conteos = Array.isArray(cuerpo.conteos)
    ? (cuerpo.conteos as Record<string, unknown>[])
        .filter((c) => esUuid(String(c.item_id ?? "")))
        .map((c) => ({
          item_id: String(c.item_id),
          qty_confirmada: Number(c.qty_confirmada ?? 0),
          nota: c.nota ? String(c.nota) : null,
        }))
    : [];

  const turnoId = esUuid(String(cuerpo.turno_id ?? "")) ? String(cuerpo.turno_id) : null;
  const fotoSha256 = cuerpo.foto_sha256 ? String(cuerpo.foto_sha256) : null;

  const confirmacion = await confirmarManifiesto(g.acto.pool, g.acto.sesion, g.acto.slug, {
    paradaId: id,
    empresaClienteId,
    conteos,
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo: cuerpo.ts_dispositivo ? String(cuerpo.ts_dispositivo) : new Date().toISOString(),
    tzOffsetMin: Number(cuerpo.tz_offset_min ?? 0),
    // La ÚNICA modal del sistema, ya respondida en el andén (§7.6) [AC-FRUT-10]. Repetir la
    // pregunta acá no agregaría información: solo perdería el conteo.
    incompletoConfirmado: cuerpo.incompleto_confirmado === true,
    turnoId,
    fotoSha256,
  });

  // 2xx SIEMPRE (§4.2). El 200 del replay lo distingue del 201 de la primera vez, sin que
  // ninguno de los dos sea un error.
  return Response.json(confirmacion, { status: confirmacion.repetido ? 200 : 201 });
}
