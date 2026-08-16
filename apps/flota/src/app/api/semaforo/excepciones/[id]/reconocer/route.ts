import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { reconocerExcepcion } from "../../../../../../servidor/review-queue.ts";

// Peek N1 — reconocer una excepción [AC-FSEM-04] — spec 05 §2.2, §2.4, §2.8.
//
// `nueva → reconocida`, con el actor como `asignado_a` (salvo reasignación explícita, que es
// de Nivel 2 / AC-FSEM-05). `guardia()` es la misma puerta del resto del plano de control del
// dueño (§2.8: el tablero es SOLO `admin_tenant`): sin sesión ⇒ 404 pelado, con sesión de otro
// rol ⇒ 403, recurso de otro tenant ⇒ 404 por construcción (la fila de B no está en la base
// que el ruteo eligió). Re-reconocer una excepción que ya dejó `nueva` es una transición
// ilegal y rebota 422 tipado — 0 filas cambiadas, porque el UPDATE va con `estado = 'nueva'`
// en el WHERE.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  const resultado = await reconocerExcepcion(g.acto.pool, g.acto.sesion, id);
  if (resultado.tipo === "no_existe") return noExiste();
  if (resultado.tipo === "transicion_ilegal") {
    return Response.json(
      {
        error: "transicion_ilegal",
        mensaje: `Esta excepción ya está en estado «${resultado.estadoActual}» — reconocer solo aplica a una excepción nueva.`,
        estadoActual: resultado.estadoActual,
      },
      { status: 422 },
    );
  }
  return Response.json({ id: resultado.id, estado: "reconocida", asignadoA: resultado.asignadoA });
}
