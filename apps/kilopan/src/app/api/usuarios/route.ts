import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";

const ROLES = ["admin", "maestro", "vendedor", "repartidor"];

// Solo id/nombre/rol: ni el RUT ni nada de identidad viaja de más. El pin_hash
// obviamente jamás sale de la BD. Aun así es la nómina completa del personal —
// solo /pedidos la consulta (para armar rutas) y esa pantalla es admin-only.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const rol = request.nextUrl.searchParams.get("rol");
  if (rol && !ROLES.includes(rol)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  const r = await db.query<{ id: string; nombre: string; rol: string }>(
    `select id, nombre, rol from pan.usuarios
      where activo and ($1::text is null or rol = $1) order by nombre`,
    [rol]
  );
  return NextResponse.json({ usuarios: r.rows });
}
