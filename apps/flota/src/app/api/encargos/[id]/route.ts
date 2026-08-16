import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import { editarEncargo } from "../../../../servidor/encargos.ts";

// El contratante corrige su encargo, y solo hasta la aceptación [AC-FRUT-03] — §3.E1.10, §4.2.
//
// PLANIFICACIÓN: rebota 422 con 0 filas. Rebotar una corrección no pierde ningún hecho del
// mundo; dejarla pasar sobre un encargo ya aceptado —que puede estar en una ruta armada de
// madrugada— manda el camión a otra cuadra.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const destinoId = cuerpo.destino_id ? String(cuerpo.destino_id) : undefined;
  if (destinoId !== undefined && !esUuid(destinoId)) {
    return Response.json(
      { error: "destino_no_existe", mensaje: "Ese destino no está cargado todavía." },
      { status: 422 },
    );
  }

  const edicion = await editarEncargo(g.acto.pool, g.acto.sesion, id, {
    ...(destinoId !== undefined ? { destinoId } : {}),
    ...(cuerpo.bultos !== undefined ? { bultos: Number(cuerpo.bultos) } : {}),
    ...(cuerpo.attrs !== undefined ? { attrs: cuerpo.attrs as Record<string, unknown> } : {}),
    ...(cuerpo.fecha_servicio !== undefined
      ? { fechaServicio: String(cuerpo.fecha_servicio) }
      : {}),
  });

  // Un encargo de otro tenant y uno que no existe se ven IGUAL: 404 sin cuerpo (§0, §9.3.2).
  if (edicion.tipo === "no_existe") return noExiste();
  // Y el de otra persona de la misma empresa también: decir «existe pero no es tuyo» le
  // enumeraría al contratante los pedidos de sus compañeros.
  if (edicion.tipo === "no_es_de_su_creador") return noExiste();
  if (edicion.tipo === "ya_aceptado") {
    return Response.json(
      {
        error: "ya_aceptado",
        mensaje:
          "Este encargo ya lo aceptó la casa y no se puede corregir. Llamá para cambiarlo.",
        estado: edicion.estado,
      },
      { status: 422 },
    );
  }
  if (edicion.tipo === "bultos_fuera_de_rango") {
    return Response.json(
      {
        error: "bultos_fuera_de_rango",
        mensaje:
          "Los bultos van de 1 a 500. Un cero no es un encargo y más de 500 es un camión entero.",
      },
      { status: 422 },
    );
  }
  if (edicion.tipo === "fecha_invalida") {
    return Response.json(
      { error: "fecha_invalida", mensaje: "La fecha de servicio no es una fecha válida (AAAA-MM-DD)." },
      { status: 422 },
    );
  }
  if (edicion.tipo === "attrs_invalidos") {
    return Response.json(
      {
        error: "attrs_invalidos",
        mensaje: "Falta un dato del tipo de carga, o uno de los que mandaste no es de ese tipo.",
        detalle: edicion.detalle,
      },
      { status: 422 },
    );
  }
  return Response.json({ encargo: edicion.encargo });
}
