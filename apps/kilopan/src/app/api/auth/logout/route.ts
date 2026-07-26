import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { cabeceraCookieSesionBorrada, obtenerSesionActual } from "@/identidad/sesion.ts";

export async function POST(request: NextRequest) {
  const sesion = await obtenerSesionActual(request);
  if (sesion) {
    const db = await obtenerDb();
    await db.query(`update pan.sesiones_operador set fin = now() where id = $1 and fin is null`, [
      sesion.sesionId,
    ]);
  }
  const respuesta = NextResponse.json({ ok: true });
  respuesta.headers.set("Set-Cookie", cabeceraCookieSesionBorrada(request));
  return respuesta;
}
