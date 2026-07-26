import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

// Las líneas de pedido que están esperando pan de un producto dado: lo que el maestro
// necesita ver para saber a qué despacho va la bandeja que acaba de pesar.
//
// `gramos_pesados` lo mantiene un trigger sumando los pesajes (nunca la app), así que
// «lo que falta» sale derivado y no de un contador que alguien pueda desincronizar.
// Se muestran también las líneas ya completas: si el maestro pesó de más, tiene que
// poder verlo y elegir igual, no quedarse sin destino con la bandeja en la mano.
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const productoId = request.nextUrl.searchParams.get("productoId");
  if (!productoId) {
    return NextResponse.json({ error: "Falta productoId" }, { status: 400 });
  }

  const db = await obtenerDb();
  const r = await db.query<Record<string, unknown>>(
    `select pl.id as linea_id,
            pl.gramos_pedidos,
            pl.gramos_pesados,
            greatest(pl.gramos_pedidos - pl.gramos_pesados, 0) as gramos_faltantes,
            p.id as pedido_id,
            p.correlativo_pedido,
            p.fecha_entrega,
            c.razon_social
       from pan.pedido_lineas pl
       join pan.pedidos p on p.id = pl.pedido_id
       join pan.clientes c on c.id = p.cliente_id
      where pl.producto_id = $1
        and p.fecha_entrega >= current_date
        -- 'confirmado' y 'pesado': un pedido en borrador todavía no tiene correlativo
        -- y puede cambiar; uno en ruta o entregado ya salió y no admite más pan.
        and p.estado in ('confirmado', 'pesado')
      order by p.fecha_entrega, p.correlativo_pedido nulls last`,
    [productoId]
  );
  return NextResponse.json({ lineas: r.rows });
}
