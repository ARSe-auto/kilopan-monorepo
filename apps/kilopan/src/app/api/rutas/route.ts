import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  // El repartidor ve SOLO su ruta; el admin ve todas.
  const r = await db.query<Record<string, unknown>>(
    `select r.id, r.fecha, r.estado, r.vehiculo, r.km_inicio, r.km_fin,
            u.nombre as repartidor,
            (select count(*)::int from pan.ruta_paradas rp where rp.ruta_id = r.id) as paradas,
            (select count(*)::int from pan.ruta_paradas rp
               where rp.ruta_id = r.id and not exists (
                 select 1 from pan.documento_tributario d
                  where d.pedido_id = rp.pedido_id and d.estado = 'registrado')) as paradas_sin_dte
       from pan.rutas r
       join pan.usuarios u on u.id = r.repartidor_id
      where r.fecha = current_date and ($1 = 'admin' or r.repartidor_id = $2)
      order by r.estado`,
    [sesion.rol, sesion.usuarioId]
  );
  return NextResponse.json({ rutas: r.rows });
}

export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador arma rutas" }, { status: 403 });
  }

  let cuerpo: { repartidorId?: string; vehiculo?: string; pedidoIds?: string[] };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { repartidorId, vehiculo, pedidoIds } = cuerpo;
  if (!repartidorId || !pedidoIds?.length) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  const db = await obtenerDb();
  const ruta = await db.query<{ id: string }>(
    `insert into pan.rutas (repartidor_id, vehiculo) values ($1,$2) returning id`,
    [repartidorId, vehiculo ?? null]
  );
  const rutaId = ruta.rows[0]?.id;
  if (!rutaId) return NextResponse.json({ error: "No se pudo crear la ruta" }, { status: 500 });

  // Orden a mano: el índice del array ES el orden de la ruta (sin VRP, por diseño).
  for (const [i, pedidoId] of pedidoIds.entries()) {
    await db.query(`insert into pan.ruta_paradas (ruta_id, pedido_id, orden) values ($1,$2,$3)`, [
      rutaId,
      pedidoId,
      i + 1,
    ]);
  }
  return NextResponse.json({ id: rutaId, paradas: pedidoIds.length });
}

// AC-DES-02: «Salir a ruta». El trigger de la BD es el que manda — si falta un DTE,
// esto rebota y devuelve el motivo textual, sin override posible desde acá.
export async function PATCH(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { rutaId?: string; estado?: string; kmInicio?: number; kmFin?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { rutaId, estado, kmInicio, kmFin } = cuerpo;
  if (!rutaId || !estado) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

  const db = await obtenerDb();
  try {
    await db.query(
      `update pan.rutas
          set estado = $1,
              km_inicio = coalesce($2, km_inicio),
              km_fin = coalesce($3, km_fin)
        where id = $4`,
      [estado, kmInicio ?? null, kmFin ?? null, rutaId]
    );
    return NextResponse.json({ ok: true, estado });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/sin DTE asociado/i.test(mensaje)) {
      return NextResponse.json(
        { error: "No podés salir: hay pedidos sin guía o factura asociada (art. 55 DL 825)" },
        { status: 409 }
      );
    }
    console.error("PATCH /api/rutas:", mensaje);
    return NextResponse.json({ error: "No se pudo actualizar la ruta" }, { status: 500 });
  }
}
