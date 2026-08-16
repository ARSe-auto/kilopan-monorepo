import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { duplicarSemana } from "../../../../servidor/agenda.ts";

// «Duplicar semana» [AC-FVEH-07] — §3.E1.4.
//
// CLONA LOS BLOQUES REALES DE 7 DÍAS ATRÁS, jamás una plantilla. La diferencia es de fondo:
// una plantilla es lo que alguien planeó alguna vez y quedó guardado; los bloques reales son
// lo que la semana pasada de verdad tuvo, con los arreglos que se le hicieron el martes.
// Clonar la plantilla devuelve la agenda al estado del que ya se había corregido.
//
// LA COLISIÓN NO SE DECIDE ACÁ. El maestro no cierra qué pasa cuando la semana destino ya
// tiene bloques —¿todo-o-nada, o bloque a bloque con reporte de los que rebotaron?— y es la
// pregunta 12 de la spec 02. Esta ruta no elige: no procede y lo dice con esas palabras.
// Quedarse con «todo-o-nada» porque es lo que sale gratis de una transacción sería responder
// por el dueño y, peor, dejar la pregunta respondida sin que nadie lo note.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: { vehiculo_id?: unknown; desde?: unknown };
  try {
    cuerpo = (await peticion.json()) as { vehiculo_id?: unknown; desde?: unknown };
  } catch {
    cuerpo = {};
  }

  const desde = new Date(String(cuerpo.desde ?? ""));
  if (Number.isNaN(desde.getTime())) {
    return Response.json(
      { error: "semana_invalida", mensaje: "Decime desde qué día empieza la semana que querés armar." },
      { status: 422 },
    );
  }

  const resultado = await duplicarSemana(
    g.acto.pool,
    g.acto.sesion,
    String(cuerpo.vehiculo_id ?? ""),
    desde,
  );

  if (resultado.tipo === "vehiculo_no_existe") {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Ese vehículo no está en tu flota." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "semana_vacia") {
    // Desenlace propio y no un «ok con cero»: quien apretó el botón esperaba una agenda y se
    // quedó con la pantalla igual. Decirlo es la diferencia entre «no había qué copiar» y «la
    // app no hizo nada».
    return Response.json(
      {
        error: "semana_vacia",
        mensaje: "La semana anterior no tenía bloques para este vehículo, así que no hay nada que copiar.",
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "colision_no_resuelta") {
    return Response.json(
      {
        error: "colision_no_resuelta",
        mensaje:
          "Esa semana ya tiene bloques que chocan con los de la anterior. Todavía no está " +
          "decidido si en ese caso se copia lo que entra o no se copia nada, así que no se " +
          "copió nada: sacá los bloques que estorban y volvé a intentar.",
      },
      { status: 422 },
    );
  }
  return Response.json({ clonados: resultado.clonados }, { status: 201 });
}
