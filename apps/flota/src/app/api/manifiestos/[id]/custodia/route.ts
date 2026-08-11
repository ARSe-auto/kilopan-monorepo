import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { traspasarCustodia } from "../../../../../servidor/manifiestos.ts";

// El traspaso de custodia (F2) [AC-FRUT-09] — §4.3, §4.5, §4.6, §5.2 F2.
//
// El momento en que la mercadería deja de ser del andén y pasa a ser del chofer. Tres semanas
// después, «yo la entregué completa» y «a mí me la dieron así» son dos afirmaciones sin nada en
// medio salvo esta fila.
//
// El PIN es lo ÚNICO que rebota en este flujo, y rebota porque ocurre con la persona presente:
// no es una captura que llega por sync. Todo lo demás entra.
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

  const liberoUsuarioId = String(cuerpo.libero_usuario_id ?? "");
  const recibeUsuarioId = String(cuerpo.recibe_usuario_id ?? "");
  if (!esUuid(liberoUsuarioId) || !esUuid(recibeUsuarioId)) {
    return Response.json(
      {
        error: "faltan_firmantes",
        mensaje: "Hace falta quién libera la carga y quién la recibe.",
      },
      { status: 422 },
    );
  }

  const traspaso = await traspasarCustodia(g.acto.pool, g.acto.sesion, {
    manifiestoId: id,
    liberoUsuarioId,
    liberoPin: String(cuerpo.libero_pin ?? ""),
    recibeUsuarioId,
    recibePin: String(cuerpo.recibe_pin ?? ""),
    sello: cuerpo.sello ? String(cuerpo.sello) : null,
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo: cuerpo.ts_dispositivo ? String(cuerpo.ts_dispositivo) : new Date().toISOString(),
    tzOffsetMin: Number(cuerpo.tz_offset_min ?? 0),
  });

  if (traspaso.tipo === "manifiesto_no_existe") return noExiste();
  if (traspaso.tipo === "pin_invalido") {
    // El único rebote del flujo. No dice CUÁL de los dos PIN falló: quien está enfrente ya lo
    // sabe, y decirlo le daría a un tercero la mitad de un oráculo.
    return Response.json(
      { error: "pin_invalido", mensaje: "El PIN no coincide. Volvé a intentar." },
      { status: 422 },
    );
  }
  if (traspaso.tipo === "ya_traspasado") return noExiste();

  return Response.json(traspaso, { status: traspaso.repetido ? 200 : 201 });
}
