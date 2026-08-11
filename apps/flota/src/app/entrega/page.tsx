import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { esUuid } from "../../servidor/gobierno.ts";
import { poolDe } from "../../servidor/conexion.ts";
import { horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import type { ParadaDeRuta } from "../../dominio/pod-terreno.ts";
import TarjetaDeEntrega from "./tarjeta-de-entrega.tsx";

// La envoltura de servidor de la tarjeta de entrega [AC-FRUT-22, AC-FPOD-01] — §0 (contrato
// HTTP), §5.2 F4, §7.2, §9.3.2 (centinela 2).
//
// Mismo patrón que `ruta/cerrar/page.tsx`: la parada viaja en la CONSULTA y no como segmento,
// porque el App Router serializa el árbol de segmentos —con el valor concreto del parámetro—
// dentro del HTML que sirve, incluso en el 404. La existencia (y que sea de tipo `entrega`) se
// resuelve ACÁ, antes de pintar nada; el candado en sí lo sirve `/api/paradas/[id]/entrega`.
//
// ─── LA SECUENCIA ENTERA VIAJA CON LA PRIMERA CARGA ──────────────────────────────
//
// F4 es un BUCLE LINEAL (§5.2): el «avance automático» de la segunda acción tiene que dejar la
// tarjeta siguiente a la vista sin costar un toque ni una navegación. Por eso las paradas de
// entrega de la ruta —con su destino, su ventana y sus bultos— salen de una sola consulta acá y
// no de un viaje por parada: en un subterráneo sin señal, un `fetch` entre parada y parada es
// una tarjeta que no aparece.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lo que devuelve la consulta, en la forma en que la BD lo entrega. */
type FilaDeParada = {
  id: string;
  orden: number;
  destino: string;
  desde: Date | null;
  hasta: Date | null;
  bultos: number;
};

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
  const { rows: deLaParada } = await pool.query<{ ruta_id: string }>(
    "select ruta_id::text as ruta_id from paradas where id = $1 and tipo = 'entrega'",
    [pedida],
  );
  if (!deLaParada[0]) notFound();

  const { rows } = await pool.query<FilaDeParada>(
    `select p.id::text        as id,
            p.orden           as orden,
            d.nombre          as destino,
            lower(p.ventana)  as desde,
            upper(p.ventana)  as hasta,
            coalesce(sum(i.qty_planificada), 0)::int as bultos
       from paradas p
       join destinos d on d.id = p.destino_id
       left join items i on i.parada_id = p.id
      where p.ruta_id = $1 and p.tipo = 'entrega'
      group by p.id, p.orden, d.nombre, p.ventana
      order by p.orden`,
    [deLaParada[0].ruta_id],
  );

  const secuencia: ParadaDeRuta[] = rows.map((f) => ({
    id: f.id,
    orden: f.orden,
    destino: f.destino,
    // La ventana se formatea acá, con el huso de Chile: mandarla cruda al cliente la dejaría a
    // merced del reloj del teléfono, que en terreno está tan seguido corrido como la red caída.
    ventana: f.desde && f.hasta ? `${horaEsCl(f.desde)} a ${horaEsCl(f.hasta)}` : null,
    bultos: f.bultos,
  }));

  return <TarjetaDeEntrega secuencia={secuencia} indice={secuencia.findIndex((p) => p.id === pedida)} />;
}
