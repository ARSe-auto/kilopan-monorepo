import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { esUuid } from "../../servidor/gobierno.ts";
import { poolDe } from "../../servidor/conexion.ts";
import TarjetaDeRecarga from "./tarjeta-de-recarga.tsx";

// La envoltura de servidor de la parada de recarga [AC-FPOD-13] — §5.2 F4 («Bloque de recarga
// = una parada más»), §7.2, §9.3.2 (centinela 2).
//
// Mismo patrón que `entrega/page.tsx`: la parada viaja en la CONSULTA (`?parada=`), su
// existencia (y que sea tipo `recarga`) se resuelve ACÁ contra la BD del tenant que trae la
// cabecera, y una parada que no es de este tenant —o que no es de este tipo— es un 404 sin
// distinguir «no existe» de «es de otro tenant» (centinela 2, §9.3.2).
//
// `vehiculo_id` sale de `rutas` (AC-FRUT-18 la materializa con ese vehículo) y `turno_id` del
// turno ABIERTO de ese vehículo, si hay uno: la captura viaja igual sin turno —`servidor/
// capturas.ts`/`recarga-sync.ts` la juzgan contra la config vigente, no contra ninguna.
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

  const pool = poolDe(bd);
  const { rows } = await pool.query<{ id: string; vehiculo_id: string | null }>(
    `select p.id::text as id, r.vehiculo_id::text as vehiculo_id
       from paradas p
       join rutas r on r.id = p.ruta_id
      where p.id = $1 and p.tipo = 'recarga'`,
    [pedida],
  );
  if (!rows[0] || !rows[0].vehiculo_id) notFound();

  const { rows: turnoFilas } = await pool.query<{ id: string }>(
    `select id::text as id from turnos where vehiculo_id = $1 and estado = 'abierto'
      order by abierto_en desc limit 1`,
    [rows[0].vehiculo_id],
  );

  return <TarjetaDeRecarga vehiculoId={rows[0].vehiculo_id} turnoId={turnoFilas[0]?.id ?? null} />;
}
