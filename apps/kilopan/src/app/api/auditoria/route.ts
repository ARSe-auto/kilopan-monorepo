import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";

// AC-DASH-06: lectura de la tabla append-only de eventos filtrable por usuario y dispositivo
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const url = new URL(request.url);
  const usuarioId = url.searchParams.get("usuario_id");
  const dispositivoId = url.searchParams.get("dispositivo_id");

  let query = `
    select e.id, e.tipo, e.entidad, e.entidad_id, e.payload,
           u.nombre as usuario_nombre, u.rut as usuario_rut,
           d.nombre as dispositivo_nombre,
           e.at
      from pan.eventos e
      left join pan.usuarios u on u.id = e.usuario_id
      left join pan.dispositivos d on d.id = e.dispositivo_id
     where 1=1
  `;
  const params: (string | null)[] = [];

  if (usuarioId) {
    params.push(usuarioId);
    query += ` and e.usuario_id = $${params.length}`;
  }

  if (dispositivoId) {
    params.push(dispositivoId);
    query += ` and e.dispositivo_id = $${params.length}`;
  }

  query += ` order by e.at desc limit 500`;

  const r = await db.query<{
    id: string;
    tipo: string;
    entidad: string;
    entidad_id: string | null;
    payload: Record<string, unknown>;
    usuario_nombre: string | null;
    usuario_rut: string | null;
    dispositivo_nombre: string | null;
    at: string;
  }>(query, params);

  return NextResponse.json({ eventos: r.rows });
}
