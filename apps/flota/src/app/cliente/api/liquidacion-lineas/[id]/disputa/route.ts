import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { disputarLineaDelCliente } from "../../../../../../servidor/portal-cliente.ts";

// La disputa por línea del contratante [AC-FPOR-10] — spec 07 §2.4, spec 06 §6, §4.2, §9.3.3.
// Es PLANIFICACIÓN (§4.2): rebota 422 tipado con 0 filas ante liquidación no cerrada, fuera de
// la ventana de 7 días o motivo fuera de catálogo — `disputar_linea()` (0066, AC-FTAR-06) es la
// guardia real, esto solo abre el namespace del portal con el mismo candado que el resto de
// `/cliente/*` y traduce cada rebote tipado a su 422.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es del contratante." },
    { status: 403 },
  );

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();
  if (!g.acto.sesion.empresaClienteId) return SIN_ACCESO();

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const motivoId = String(cuerpo.motivo_id ?? "");
  const clientUuid = String(cuerpo.client_uuid ?? "");
  if (!esUuid(motivoId) || !esUuid(clientUuid)) {
    return Response.json(
      { error: "faltan_datos", mensaje: "Elegí un motivo para disputar esta línea." },
      { status: 422 },
    );
  }
  const nota = cuerpo.nota ? String(cuerpo.nota) : null;

  const resultado = await disputarLineaDelCliente(g.acto.pool, g.acto.sesion, id, {
    motivoId,
    nota,
    clientUuid,
  });

  if (resultado.tipo === "no_existe") return noExiste();
  if (resultado.tipo === "liquidacion_no_cerrada") {
    return Response.json(
      {
        error: "liquidacion_no_cerrada",
        mensaje: "Solo se puede disputar una línea de una liquidación cerrada.",
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "fuera_de_ventana") {
    return Response.json(
      {
        error: "fuera_de_ventana",
        mensaje: "Ya pasaron los 7 días para disputar esta línea.",
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "motivo_invalido") {
    return Response.json(
      { error: "motivo_invalido", mensaje: "Elegí un motivo válido de la lista." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "ya_disputada") {
    return Response.json(
      { error: "ya_disputada", mensaje: "Esta línea ya tiene una disputa registrada." },
      { status: 422 },
    );
  }
  return Response.json({ ok: true, repetida: resultado.repetida }, { status: resultado.repetida ? 200 : 201 });
}
