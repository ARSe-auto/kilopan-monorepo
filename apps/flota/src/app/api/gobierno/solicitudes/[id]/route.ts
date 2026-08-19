import { headers } from "next/headers";
import { aprobar, rechazar } from "../../../../../servidor/aprobacion.ts";
import {
  guardia,
  registrarEvento,
  esUuid,
  noExiste,
  EVENTOS,
} from "../../../../../servidor/gobierno.ts";

// Aprobar o rechazar en 1 toque [AC-FIDN-12] — §5.4 F-C.
//
// La lógica es la de AC-FIDN-04 y no se reescribe: emparejar persona+dispositivo+rol y emitir
// el secreto UNA vez ya está construido y probado. Lo que agrega esta puerta es el gobierno —
// que solo el dueño la abra— y el rastro: el evento entra DENTRO de la transacción de la
// aprobación, por el gancho `registrar`. Escribirlo después del commit sería aceptar que un
// fallo de red deje una aprobación sin evento, y una auditoría a la que le faltan filas es
// peor que ninguna, porque se la lee con confianza.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: { accion?: unknown; empresa_cliente_id?: unknown };
  try {
    cuerpo = (await peticion.json()) as { accion?: unknown; empresa_cliente_id?: unknown };
  } catch {
    cuerpo = {};
  }
  const accion = String(cuerpo.accion ?? "");
  if (accion !== "aprobar" && accion !== "rechazar") {
    return Response.json(
      { error: "accion_desconocida", mensaje: "Acción no válida sobre la solicitud." },
      { status: 422 },
    );
  }

  const { sesion, pool } = g.acto;

  if (accion === "rechazar") {
    const r = await rechazar(pool, id, sesion.usuarioId, {
      registrar: (c) =>
        registrarEvento(c, {
          codigo: EVENTOS.solicitud_rechazada,
          objetoTabla: "solicitudes_acceso",
          objetoId: id,
          sesion,
        }).then(() => undefined),
    });
    if (r.tipo === "rechazada") return Response.json({ estado: "rechazada" });
    if (r.tipo === "rebote" && r.motivo === "solicitud_inexistente") return noExiste();
    return Response.json({ error: r.tipo === "rebote" ? r.motivo : "rebote" }, { status: 422 });
  }

  const empresaClienteId =
    typeof cuerpo.empresa_cliente_id === "string" && esUuid(cuerpo.empresa_cliente_id)
      ? cuerpo.empresa_cliente_id
      : undefined;

  const r = await aprobar(pool, id, sesion.usuarioId, {
    empresaClienteId,
    registrar: (c) =>
      registrarEvento(c, {
        codigo: EVENTOS.solicitud_aprobada,
        objetoTabla: "solicitudes_acceso",
        objetoId: id,
        sesion,
      }).then(() => undefined),
  });

  if (r.tipo === "aprobada") {
    // El SOBRE no viaja acá. Lo retira el aparato del trabajador, que es el único que puede
    // abrirlo (AC-FIDN-04); mandárselo al dueño lo pondría a pasar por sus manos un secreto
    // que no es suyo, y encima por una pantalla que se comparte.
    return Response.json({
      estado: "aprobada",
      usuario_id: r.usuarioId,
      dispositivo_id: r.dispositivoId,
      dispositivos_revocados: r.dispositivosRevocados ?? 0,
    });
  }
  if (r.motivo === "solicitud_inexistente") return noExiste();
  return Response.json(
    { error: r.motivo, titular_actual: r.titularActual ?? null },
    { status: 422 },
  );
}
