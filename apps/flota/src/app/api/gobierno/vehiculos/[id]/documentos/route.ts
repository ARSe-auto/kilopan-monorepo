import { headers } from "next/headers";
import { guardia, esUuid, noExiste } from "../../../../../../servidor/gobierno.ts";
import { cargarDocumento, listarDocumentos } from "../../../../../../servidor/documentos.ts";

// Documentos con vencimiento de un vehículo [AC-FVEH-03] — §3.E1.3, §4.5, §5.4.
//
// Bajo `/api/gobierno/**` porque el §5.4 le da al `admin_tenant` «alta, edición de
// capacidades/DOCUMENTOS y desactivación de vehículos», en la misma lista que aprobar accesos.
// El efecto práctico: el barrido autogenerado de AC-FIDN-12 recoge esta puerta sola, con su
// 403 para el operador y su 404 sin sesión, sin escribir una línea de test.
//
// El GET también es del dueño y eso es deliberado: la fecha de vencimiento de la revisión
// técnica no le sirve al chofer para decidir nada —el rebote, si el feature está encendido, se
// lo da la app al abrir el turno con un mensaje que sí puede actuar— y sí es información de la
// empresa. Lo que el operador necesita, el ESTADO del vehículo, viaja en `/api/vehiculos`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();
  return Response.json({ documentos: await listarDocumentos(g.acto.pool, id) });
}

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const alta = await cargarDocumento(g.acto.pool, g.acto.sesion, id, {
    tipo: cuerpo.tipo,
    venceEl: cuerpo.vence_el,
    sha256: cuerpo.sha256 ?? null,
  });

  if (alta.tipo === "vehiculo_no_existe") return noExiste();
  if (alta.tipo === "tipo_invalido") {
    // No se ofrece una lista de tipos válidos porque no la hay: la pregunta 2 de la spec 02
    // —catálogo cerrado o filas por tenant— sigue abierta, y devolver tres cadenas acá la
    // respondería por el dueño.
    return Response.json(
      { error: "tipo_invalido", mensaje: "Escribí qué documento es (revisión técnica, permiso, SOAP…)." },
      { status: 422 },
    );
  }
  if (alta.tipo === "fecha_invalida") {
    return Response.json(
      { error: "fecha_invalida", mensaje: "El documento necesita su fecha de vencimiento." },
      { status: 422 },
    );
  }
  if (alta.tipo === "sha256_invalido") {
    return Response.json(
      {
        error: "sha256_invalido",
        mensaje: "El resumen del archivo no tiene la forma de un sha256. El documento no se guardó.",
      },
      { status: 422 },
    );
  }
  return Response.json({ documento: alta.documento }, { status: 201 });
}
