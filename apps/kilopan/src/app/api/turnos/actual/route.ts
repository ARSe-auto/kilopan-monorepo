import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";

// El turno abierto de ESTE dispositivo, o null. La futura pantalla de apertura (Ola 2)
// la usa para decidir si mostrar "Abrir turno" o el chip con el fondo inicial; el
// cierre de caja la usa para saber si hay algo que cerrar.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "vendedor"]);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<{ id: string; abierto_at: string; fondo_inicial_clp: number }>(
    `select id, abierto_at, fondo_inicial_clp from pan.turnos
      where dispositivo_id = $1 and cerrado_at is null`,
    [sesion.dispositivoId]
  );
  return NextResponse.json({ turno: r.rows[0] ?? null });
}
