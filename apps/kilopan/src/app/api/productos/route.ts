import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<{ id: string; nombre: string; tipo_venta: string }>(
    `select id, nombre, tipo_venta from pan.productos where activo order by nombre`
  );
  return NextResponse.json({ productos: r.rows });
}
