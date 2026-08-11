import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { registrarFotoDeManifiesto } from "../../../../../servidor/manifiestos.ts";

// El binario de la foto del sub-manifiesto [AC-FRUT-10] — §4.6, §7.6, §4.2.
//
// El hash ya viajó en la mutación de «Conforme»; acá llega el archivo y el servidor lo
// RE-HASHEA. Si no coincide, la evidencia entra igual con su flag: la foto es mejora progresiva
// y jamás dependencia (§7.6), así que un binario cortado a mitad de subida en el andén no puede
// invalidar el conteo, que es el dato por el que existe el manifiesto.
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

  const foto = await registrarFotoDeManifiesto(g.acto.pool, g.acto.sesion, g.acto.slug, {
    manifiestoId: id,
    contenidoB64: String(cuerpo.contenido_b64 ?? ""),
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo: cuerpo.ts_dispositivo ? String(cuerpo.ts_dispositivo) : new Date().toISOString(),
    tzOffsetMin: Number(cuerpo.tz_offset_min ?? 0),
    turnoId: esUuid(String(cuerpo.turno_id ?? "")) ? String(cuerpo.turno_id) : null,
  });

  // Un manifiesto de otro tenant no existe (§0, §5.5). Es lo único que contesta 4xx acá: no es
  // degradar una captura, es no tener a qué colgarla.
  if (foto.tipo === "manifiesto_no_existe") return noExiste();

  return Response.json(foto, { status: foto.repetida ? 200 : 201 });
}
