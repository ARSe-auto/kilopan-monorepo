import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { esUuid } from "../../servidor/gobierno.ts";
import { poolDe } from "../../servidor/conexion.ts";
import TarjetaDeEntrega from "./tarjeta-de-entrega.tsx";

// La envoltura de servidor de la tarjeta de entrega [AC-FRUT-22] — §0 (contrato HTTP), §7.2,
// §9.3.2 (centinela 2).
//
// Mismo patrón que `ruta/cerrar/page.tsx`: la parada viaja en la CONSULTA y no como segmento,
// porque el App Router serializa el árbol de segmentos —con el valor concreto del parámetro—
// dentro del HTML que sirve, incluso en el 404. La existencia (y que sea de tipo `entrega`) se
// resuelve ACÁ, antes de pintar nada; el candado en sí lo sirve `/api/paradas/[id]/entrega`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const consulta = await searchParams;
  const pedida = Array.isArray(consulta.parada) ? consulta.parada[0] : consulta.parada;
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd || !pedida || !esUuid(pedida)) notFound();

  const { rows } = await poolDe(bd).query(
    "select 1 from paradas where id = $1 and tipo = 'entrega'",
    [pedida],
  );
  if (!rows[0]) notFound();

  return <TarjetaDeEntrega paradaId={pedida} />;
}
