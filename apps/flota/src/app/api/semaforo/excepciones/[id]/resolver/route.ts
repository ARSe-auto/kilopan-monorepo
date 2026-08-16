import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { resolverExcepcion } from "../../../../../../servidor/review-queue.ts";

// Detalle N2 — resolver una excepción [AC-FSEM-05] — spec 05 §2.3, §2.4, §2.8.
//
// `reconocida → resuelta`, con nota OBLIGATORIA (`review_queue_resuelta_con_nota` en la
// migración 0002 es el backstop de la base; acá se valida antes para dar el 422 tipado). El
// endpoint NO lleva parámetro de origen/severidad — «el rojo lo exige» (§2.3) es una conducta
// de la UI (AC-FSEM-05: el peek N1 nunca ofrece resolver), no una rama de este handler; una
// regla dura de servidor en términos de ESTADO queda sujeta a la pregunta 9 de la spec.
// Mismo criterio de rebote que `reconocer` (AC-FSEM-04): sin sesión ⇒ 404, rol distinto de
// `admin_tenant` ⇒ 403, excepción de otro tenant ⇒ 404, transición ilegal ⇒ 422 con 0 filas.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let nota = "";
  try {
    const cuerpo = (await peticion.json()) as { nota?: unknown };
    if (typeof cuerpo.nota === "string") nota = cuerpo.nota;
  } catch {
    // Cuerpo ausente o mal formado se trata igual que nota vacía: el 422 de abajo lo explica.
  }

  const resultado = await resolverExcepcion(g.acto.pool, g.acto.sesion, id, nota);
  if (resultado.tipo === "no_existe") return noExiste();
  if (resultado.tipo === "nota_vacia") {
    return Response.json(
      {
        error: "nota_requerida",
        mensaje: "Resolver una excepción exige una nota — el rojo también, sin excepción.",
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "transicion_ilegal") {
    return Response.json(
      {
        error: "transicion_ilegal",
        mensaje: `Esta excepción está en estado «${resultado.estadoActual}» — resolver exige pasar antes por reconocida.`,
        estadoActual: resultado.estadoActual,
      },
      { status: 422 },
    );
  }
  return Response.json({ id: resultado.id, estado: "resuelta" });
}
