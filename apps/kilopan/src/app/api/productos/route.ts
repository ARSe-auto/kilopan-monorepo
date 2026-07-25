import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<{
    id: string;
    nombre: string;
    tipo_venta: string;
    precio_mostrador_clp: number | null;
    stock_disponible_g: number;
  }>(`
    select p.id, p.nombre, p.tipo_venta,
           (select precio_clp from pan.precios
             where producto_id = p.id and lista = 'mostrador' and vigente_desde <= current_date
             order by vigente_desde desc limit 1) as precio_mostrador_clp,
           pan.stock_disponible(p.id) as stock_disponible_g
      from pan.productos p
     where p.activo
     order by p.nombre
  `);
  return NextResponse.json({ productos: r.rows });
}
