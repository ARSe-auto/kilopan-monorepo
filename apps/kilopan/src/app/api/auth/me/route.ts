import { NextResponse, type NextRequest } from "next/server";
import { obtenerSesionActual } from "@/identidad/sesion.ts";

export async function GET(request: NextRequest) {
  const sesion = await obtenerSesionActual(request);
  if (!sesion) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  return NextResponse.json({
    usuario: { id: sesion.usuarioId, nombre: sesion.nombre, rol: sesion.rol },
  });
}
