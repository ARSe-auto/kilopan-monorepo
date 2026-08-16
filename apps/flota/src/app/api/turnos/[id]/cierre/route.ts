import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { cerrarTurno } from "../../../../../servidor/turnos.ts";

// El cierre del turno (F5) [AC-FVEH-21] — §5.2-F5, §4.5, §4.2.
//
// Cierra y nada más. El chequeo post, la nota al siguiente turno y las dos lecturas van por sus
// propias puertas —`/api/chequeos` y `/api/lecturas`, las dos de CAPTURA— porque si alguna
// fallara, el turno ya quedó cerrado y nadie tiene que volver a hacerlo. Al revés —cerrar solo
// si todo lo demás entró— haría que un problema de red dejara al chofer con el turno abierto.
//
// «¿QUEDÓ ENCHUFADO?» ES OBLIGATORIO. El §5.2-F5 lo pone en el cierre, y el rojo del Anexo B se
// apoya en poder distinguir «no quedó» de «todavía no se preguntó»: un `undefined` guardado
// como NULL dejaría el turno indistinguible de uno que nadie cerró.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: { enchufado?: unknown };
  try {
    cuerpo = (await peticion.json()) as { enchufado?: unknown };
  } catch {
    cuerpo = {};
  }

  const cierre = await cerrarTurno(g.acto.pool, g.acto.sesion, id, { enchufado: cuerpo.enchufado });
  if (cierre.tipo === "no_existe") return noExiste();
  if (cierre.tipo === "sin_respuesta_de_enchufe") {
    return Response.json(
      {
        error: "sin_respuesta_de_enchufe",
        mensaje: "Falta decir si el vehículo quedó enchufado. Es sí o no, y la app necesita las dos.",
      },
      { status: 422 },
    );
  }
  if (cierre.tipo === "ya_no_esta_abierto") {
    return Response.json(
      { error: "ya_no_esta_abierto", mensaje: "Ese turno ya estaba cerrado." },
      { status: 422 },
    );
  }
  return Response.json({ turno_id: cierre.turnoId, estado: "cerrado" });
}
