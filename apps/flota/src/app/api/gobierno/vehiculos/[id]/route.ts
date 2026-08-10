import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { editarVehiculo, desactivarVehiculo } from "../../../../../servidor/vehiculos.ts";

// Editar y desactivar un vehículo: los otros dos actos del dueño [AC-FVEH-02] — §5.4, §7.4,
// centinela 15 §9.3.
//
// LOS TRES DESENLACES, y son los mismos que el resto del panel porque la regla es una sola:
//
//   · sin sesión válida ⇒ 404 PELADO. Sobre una ruta que nombra un recurso, un 401 confirma
//     que ese uuid es real, y eso ES el oráculo de enumeración que el §0 cierra con «404
//     jamás 403». Un id mal formado sale igual que uno ausente, por lo mismo.
//   · sesión válida con rol `operador` ⇒ 403 y CERO filas (centinela 15). El operador SÍ es de
//     la casa: esconderle la puerta lo dejaría reportando «no me anda» sobre algo que funciona.
//     Y conserva lo suyo intacto — lee y asigna por `/api/vehiculos`.
//   · vehículo de OTRO tenant ⇒ 404, por construcción: cada tenant es su propia base (§4.1) y
//     un id de B sencillamente no está acá.
//
// EL DELETE NO BORRA. Se materializa como desactivación (§5.4 habla de «desactivación» y §7.4
// prohíbe destruir datos con evidencia): la fila y su historia —lecturas, chequeos, turnos—
// siguen enteras, que es con lo que la EEVD se computa hacia atrás (§2).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const edicion = await editarVehiculo(g.acto.pool, g.acto.sesion, id, cuerpo);
  if (edicion.tipo === "no_existe") return noExiste();
  if (edicion.tipo === "sin_cambios") {
    return Response.json(
      { error: "sin_cambios", mensaje: "No mandaste ningún campo para cambiar." },
      { status: 422 },
    );
  }
  if (edicion.tipo === "campo_no_editable") {
    // Nombrar el campo y decir POR QUÉ: `patente` es la identidad del vehículo y `odometro`
    // y `soc` son proyecciones de las lecturas (§4.5). Un «campo inválido» a secas dejaría a
    // quien integra probando combinaciones.
    return Response.json(
      {
        error: "campo_no_editable",
        campo: edicion.campo,
        mensaje:
          `«${edicion.campo}» no se edita desde acá: la patente es la identidad del vehículo, ` +
          "y el odómetro y la carga entran por las lecturas del turno.",
      },
      { status: 422 },
    );
  }
  if (edicion.tipo === "valor_invalido") {
    return Response.json(
      {
        error: "valor_invalido",
        campo: edicion.campo,
        mensaje: `El valor de «${edicion.campo}» no tiene la forma que esa ficha espera.`,
      },
      { status: 422 },
    );
  }
  return Response.json({ vehiculo: edicion.vehiculo, reactivado: edicion.reactivado });
}

export async function DELETE(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  const hecho = await desactivarVehiculo(g.acto.pool, g.acto.sesion, id);
  if (hecho.tipo === "no_existe") return noExiste();
  // Desactivar dos veces no es un acto nuevo: se contesta lo mismo y no se escribe un segundo
  // evento, que en la auditoría se leería como si hubiera pasado dos veces.
  return Response.json({ estado: hecho.tipo === "ok" ? "desactivado" : "ya_estaba_desactivado" });
}
