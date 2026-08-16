import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { candadoDeLaEntrega } from "../../../../../servidor/paradas.ts";

// El candado entrega←manifiesto (F4) [AC-FRUT-22] — KR-29, §4.2, §3.E1.5.
//
// Es LECTURA pura: la validación bloqueante corre en el CLIENTE contra este snapshot (§4.2).
// El GET no rechaza nada — dice la verdad sobre qué empresas tienen su sub-manifiesto
// confirmado, para que la tarjeta decida si ofrece «Llegué».
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const estado = await candadoDeLaEntrega(g.acto.pool, g.acto.sesion, id);
  if (estado.tipo === "no_es_entrega") return noExiste();

  return Response.json(
    estado.abierta
      ? { abierta: true, empresas_faltantes: [] }
      : {
          abierta: false,
          empresas_faltantes: estado.empresasFaltantes.map((e) => ({
            id: e.id,
            razon_social: e.razonSocial,
          })),
        },
  );
}
