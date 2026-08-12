import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { reasignarExcepcion } from "../../../../../../servidor/review-queue.ts";

// Detalle N2 — reasignar una excepción [AC-FSEM-20] — spec 05 §2.3, §2.4, §2.8.
//
// Transfiere `asignado_a` a otro usuario del tenant (PLANIFICACIÓN §4.2: valida online y
// rebota, `audit_trail` por el trigger de la tabla). Mismo criterio de rebote que
// reconocer/resolver (AC-FSEM-04/05): sin sesión ⇒ 404, rol distinto de `admin_tenant` ⇒ 403,
// excepción de otro tenant ⇒ 404 por construcción, excepción resuelta ⇒ 422 tipado con 0 filas
// cambiadas — «el rojo lo exige» no aplica acá: reasignar no distingue severidad, la única
// puerta cerrada es una excepción que ya terminó su ciclo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let usuarioId = "";
  try {
    const cuerpo = (await peticion.json()) as { usuarioId?: unknown };
    if (typeof cuerpo.usuarioId === "string") usuarioId = cuerpo.usuarioId;
  } catch {
    // Cuerpo ausente o mal formado se trata igual que usuarioId vacío: el 422 de abajo lo explica.
  }
  if (!esUuid(usuarioId)) {
    return Response.json(
      {
        error: "usuario_invalido",
        mensaje: "Reasignar exige el id de un usuario activo de este tenant.",
      },
      { status: 422 },
    );
  }

  const resultado = await reasignarExcepcion(g.acto.pool, g.acto.sesion, id, usuarioId);
  if (resultado.tipo === "no_existe") return noExiste();
  if (resultado.tipo === "usuario_invalido") {
    return Response.json(
      {
        error: "usuario_invalido",
        mensaje: "Ese usuario no existe, no está activo o no es de este tenant.",
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "transicion_ilegal") {
    return Response.json(
      {
        error: "transicion_ilegal",
        mensaje: `Esta excepción está en estado «${resultado.estadoActual}» — una excepción resuelta no se reasigna.`,
        estadoActual: resultado.estadoActual,
      },
      { status: 422 },
    );
  }
  return Response.json({ id: resultado.id, asignadoA: resultado.asignadoA });
}
