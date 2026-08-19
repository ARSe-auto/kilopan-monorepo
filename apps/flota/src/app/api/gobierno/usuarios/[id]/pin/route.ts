import { headers } from "next/headers";
import {
  guardia,
  emitirCodigoPuente,
  desbloquearUsuario,
  esUuid,
  noExiste,
} from "../../../../../../servidor/gobierno.ts";

// Rotar PIN y desbloquear [AC-FIDN-12] — §5.4, y la Pregunta 2 respondida el 09-ago-2026.
//
// SON DOS ACTOS DISTINTOS Y NO SE MEZCLAN:
//
//   · «desbloquear» = el operario se acordó del PIN y solo está esperando que se le vaya el
//     lockout de AC-FIDN-06. No toca la credencial. Si desbloquear rotara el PIN, cada
//     olvido de cinco minutos costaría una credencial nueva y una llamada.
//   · «rotar» = el operario NO se acuerda. Y acá está lo que el dueño decidió: él NO elige el
//     PIN. Emite un CÓDIGO PUENTE de un solo uso, se lo dicta, y el operario define su PIN
//     nuevo en SU aparato (`POST /api/pin/puente`). La razón es la que hace al PIN valer algo:
//     si el dueño eligiera el PIN, lo conocería — y una firma por PIN dejaría de probar quién
//     firmó, que es exactamente para lo que existe según el §4.5 del maestro.
//
// El código en claro se devuelve UNA vez, a la pantalla del dueño, para que lo dicte. En la
// base queda solo su hash.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: { accion?: unknown };
  try {
    cuerpo = (await peticion.json()) as { accion?: unknown };
  } catch {
    cuerpo = {};
  }
  const accion = String(cuerpo.accion ?? "");

  if (accion === "desbloquear") {
    const hecho = await desbloquearUsuario(g.acto.pool, g.acto.sesion, id);
    if (hecho === null) return noExiste();
    return Response.json({ estado: "desbloqueado" });
  }

  if (accion === "rotar") {
    const puente = await emitirCodigoPuente(g.acto.pool, g.acto.sesion, id);
    if (puente === null) return noExiste();
    return Response.json(
      {
        estado: "puente_emitido",
        codigo: puente.codigo,
        instruccion: "Dictale este código. Lo tipea en su propio teléfono y ahí elige su PIN nuevo.",
      },
      { status: 201 },
    );
  }

  return Response.json(
    { error: "accion_desconocida", mensaje: "Acción no válida sobre el PIN." },
    { status: 422 },
  );
}
