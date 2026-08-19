import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../servidor/gobierno.ts";
import { puedeExportarPods, podsPorRango } from "../../../servidor/export-pods.ts";
import { filasACsv } from "../../../dominio/export-pods.ts";

// Export de PODs por rango [AC-FTEL-07] — §11: el gestor arma un CSV es-CL (`;`, dd-mm-aaaa)
// con el resultado por ítem del rango elegido, sin pedirle el dato a quien tiene acceso
// directo a la BD. Mismo criterio de acceso que `/api/torre-de-control` (AC-FTEL-04) y
// `/api/liquidaciones/[id]` (AC-FTAR-07): admin_tenant y operador, nadie más.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este export es de operación o administración." },
    { status: 403 },
  );

const PARAMETROS_INVALIDOS = () =>
  Response.json(
    {
      error: "parametros_invalidos",
      mensaje: "desde y hasta (aaaa-mm-dd) y empresa_id (uuid) son obligatorios.",
    },
    { status: 422 },
  );

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (!puedeExportarPods(g.acto.sesion.rol)) return SIN_ACCESO();

  const url = new URL(peticion.url);
  const desde = url.searchParams.get("desde") ?? "";
  const hasta = url.searchParams.get("hasta") ?? "";
  const empresaId = url.searchParams.get("empresa_id") ?? "";

  if (!FECHA.test(desde) || !FECHA.test(hasta) || !esUuid(empresaId)) return PARAMETROS_INVALIDOS();
  if (desde > hasta) {
    return Response.json(
      { error: "rango_invertido", mensaje: "desde no puede ser posterior a hasta." },
      { status: 422 },
    );
  }

  const filas = await podsPorRango(g.acto.pool, g.acto.sesion, { desde, hasta, empresaId });
  const csv = filasACsv(filas);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pods_${desde}_${hasta}.csv"`,
    },
  });
}
