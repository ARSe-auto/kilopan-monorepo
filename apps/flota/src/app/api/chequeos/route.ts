import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { registrarChequeo, MOMENTOS, INSPECTABLES } from "../../../servidor/chequeos.ts";

// Chequeo pre/post [AC-FVEH-04] — §4.2, §5.2-F3/F5, §7.6, §0 fila HTTP.
//
// SYNC DE CAPTURA = 2xx SIEMPRE. La persona ya dio la vuelta al camión, ya vio la luz quemada
// y ya la marcó; un 422 no le devuelve esa vuelta. Lo único que rebota es una llamada mal
// formada —sin inspectable o sin momento—, que no es un dato del terreno degradado sino una
// petición que no se puede interpretar.
//
// Y ENTRAR NO ES BLOQUEAR (§7.6): un ítem fallado deja su defecto escrito y la apertura del
// turno sigue. El §5.2-F3 lo dice con esas palabras. El `bloqueante` real lo marca el operador
// después, con red, desde `/api/defectos/[id]`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const tsDispositivo = cuerpo.ts_dispositivo ? new Date(String(cuerpo.ts_dispositivo)) : new Date();
  if (Number.isNaN(tsDispositivo.getTime())) {
    return Response.json(
      { error: "ts_dispositivo_invalido", mensaje: "La hora del aparato no se pudo leer." },
      { status: 422 },
    );
  }

  const resultado = await registrarChequeo(g.acto.pool, g.acto.sesion, {
    inspectableTipo: String(cuerpo.inspectable_tipo ?? "vehiculos"),
    inspectableId: String(cuerpo.inspectable_id ?? ""),
    momento: String(cuerpo.momento ?? ""),
    turnoId: cuerpo.turno_id ? String(cuerpo.turno_id) : null,
    firmaId: cuerpo.firma_id ? String(cuerpo.firma_id) : null,
    nota: cuerpo.nota ? String(cuerpo.nota) : null,
    // OK-por-defecto: el cliente manda SOLO lo malo (§5.2-F3). Sin la lista, todo bien.
    fallados: Array.isArray(cuerpo.fallados) ? cuerpo.fallados.map((f) => String(f)) : [],
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo,
    tzOffsetMin: cuerpo.tz_offset_min === undefined ? null : Number(cuerpo.tz_offset_min),
  });

  if (resultado.tipo === "momento_invalido") {
    return Response.json(
      { error: "momento_invalido", mensaje: "Un chequeo es de antes o de después del turno.", momentos: MOMENTOS },
      { status: 422 },
    );
  }
  if (resultado.tipo === "inspectable_invalido") {
    return Response.json(
      {
        error: "inspectable_invalido",
        mensaje: "Falta decir qué se chequeó.",
        inspectables: INSPECTABLES,
      },
      { status: 422 },
    );
  }
  // 200 y no 201 en el replay: el reintento no creó nada (centinela 1).
  return Response.json(
    { chequeo: resultado.chequeo },
    { status: resultado.chequeo.repetido ? 200 : 201 },
  );
}
