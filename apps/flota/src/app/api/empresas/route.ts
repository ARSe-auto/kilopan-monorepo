import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";

// Las empresas contratantes del tenant [AC-FRUT-01] — §4.5.
//
// Solo lectura y solo para armar la bandeja: el ALTA de una empresa contratante es del módulo
// de tarifas y portal (hito f), donde vive su contrato. Acá se listan para poder elegir una.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { rows } = await g.acto.pool.query(
    `select id::text as id, razon_social from empresas_cliente
      where activa order by razon_social`,
  );
  return Response.json({ empresas: rows });
}
