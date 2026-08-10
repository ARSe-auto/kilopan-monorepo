import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { asociarDocumento, esTipoDeDte } from "../../../../../servidor/manifiestos.ts";

// Asociar el DTE de un tercero a un ítem del manifiesto [AC-FRUT-08] — §7.3, art. 55 DL 825.
//
// La app REFERENCIA, jamás emite. Lo que entra acá son los datos que el andén LEE del papel:
// tipo, folio y emisor, por escaneo del TED o tecleados a mano. No hay generación de folios, ni
// de XML, ni de TED — emitir algo con apariencia de DTE sin ser emisor autorizado es el art. 97
// N°4 del Código Tributario, y eso no es una multa.
//
// El folio manual no es un fallback de segunda (§7.6): en un andén a las cuatro de la mañana el
// TED está arrugado o el teléfono es prestado y no tiene permiso de cámara. Las dos vías
// terminan en la misma fila.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const tipo = String(cuerpo.tipo ?? "");
  const folio = String(cuerpo.folio ?? "").trim();
  const emisor = String(cuerpo.emisor ?? "").trim();

  if (!esTipoDeDte(tipo) || folio === "" || emisor === "") {
    return Response.json(
      {
        error: "documento_incompleto",
        mensaje: "Un documento necesita su tipo, su folio y quién lo emitió.",
      },
      { status: 422 },
    );
  }

  const asociado = await asociarDocumento(g.acto.pool, g.acto.sesion, {
    manifiestoItemId: id,
    tipo,
    folio,
    emisor,
    fecha: cuerpo.fecha ? String(cuerpo.fecha) : null,
  });
  if (asociado.tipo === "item_no_existe") return noExiste();
  return Response.json(asociado, { status: 201 });
}
