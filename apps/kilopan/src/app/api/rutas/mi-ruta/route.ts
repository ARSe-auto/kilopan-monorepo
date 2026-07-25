import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

// El snapshot del día del repartidor: su ruta en curso con las paradas en orden.
// Deliberadamente NO incluye ningún CLP — el repartidor ve km y kg, nunca plata
// (PROMPT_MAESTRO.md §5, regla de rol).
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<Record<string, unknown>>(
    `select rp.id as parada_id, rp.pedido_id, rp.orden, rp.estado,
            c.razon_social, c.direccion, c.contacto_nombre, c.lat, c.lng,
            coalesce(sum(pl.gramos_pedidos), 0)::text as gramos_pedidos
       from pan.rutas r
       join pan.ruta_paradas rp on rp.ruta_id = r.id
       join pan.pedidos p on p.id = rp.pedido_id
       join pan.clientes c on c.id = p.cliente_id
       left join pan.pedido_lineas pl on pl.pedido_id = p.id
      where r.repartidor_id = $1 and r.fecha = current_date and r.estado in ('en_curso','cargando')
      group by rp.id, rp.pedido_id, rp.orden, rp.estado, c.razon_social, c.direccion, c.contacto_nombre, c.lat, c.lng
      order by rp.orden`,
    [sesion.usuarioId]
  );
  return NextResponse.json({ paradas: r.rows });
}
