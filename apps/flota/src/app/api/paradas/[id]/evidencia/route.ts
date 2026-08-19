import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { registrarBinarioDeEvidencia } from "../../../../../servidor/capturas.ts";

// El binario de una evidencia de la parada de POD [AC-FPOD-19] — §4.6, §7.6, §4.2.
//
// El hash ya viajó en la mutación de la captura (`entrega.pod_capturada`/`entrega.pod_deshecha`,
// campo `evidencias[].sha256`); acá llega el archivo y el servidor lo RE-HASHEA. Si no coincide,
// la evidencia entra igual con su flag: la foto es mejora progresiva y jamás dependencia (§7.6),
// así que un binario cortado a mitad de subida en la calle no puede invalidar la entrega, que ya
// se cerró.
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

  const resultado = await registrarBinarioDeEvidencia(g.acto.pool, g.acto.sesion, g.acto.slug, {
    paradaId: id,
    requisitoId: String(cuerpo.requisito_id ?? ""),
    contenidoB64: String(cuerpo.contenido_b64 ?? ""),
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo: cuerpo.ts_dispositivo ? String(cuerpo.ts_dispositivo) : new Date().toISOString(),
    tzOffsetMin: Number(cuerpo.tz_offset_min ?? 0),
    turnoId: esUuid(String(cuerpo.turno_id ?? "")) ? String(cuerpo.turno_id) : null,
  });

  // Un `requisito_id` que esta parada nunca declaró no tiene a qué colgar la evidencia (§0, §5.5):
  // no es degradar una captura, es no existir.
  if (resultado.tipo === "requisito_no_encontrado") return noExiste();

  return Response.json(resultado, { status: resultado.repetida ? 200 : 201 });
}
