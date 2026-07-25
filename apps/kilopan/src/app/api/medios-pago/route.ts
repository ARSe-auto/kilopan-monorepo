import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

// AC-PAG-01: catálogo editable por admin, no una lista fija — cada panadería prende
// solo lo que de verdad usa.
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<{ clave: string; etiqueta: string }>(
    `select clave, etiqueta from pan.medios_pago where activo order by orden`
  );
  return NextResponse.json({ mediosPago: r.rows });
}
