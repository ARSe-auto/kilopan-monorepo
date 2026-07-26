import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion, exigirRol } from "@/identidad/sesion.ts";

// AC-PAG-01: catálogo editable por admin, no una lista fija — cada panadería prende
// solo lo que de verdad usa.
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const detalle = request.nextUrl.searchParams.get("detalle") === "1";
  if (detalle) {
    if (sesion.rol !== "admin") return NextResponse.json({ error: "Solo un administrador" }, { status: 403 });
    const r = await db.query<{ clave: string; etiqueta: string; activo: boolean }>(
      `select clave, etiqueta, activo from pan.medios_pago order by orden`
    );
    return NextResponse.json({ mediosPago: r.rows });
  }

  const r = await db.query<{ clave: string; etiqueta: string }>(
    `select clave, etiqueta from pan.medios_pago where activo order by orden`
  );
  return NextResponse.json({ mediosPago: r.rows });
}

// El catálogo de 8 medios (0003) es fijo a propósito — "prender/apagar lo que de
// verdad usa", no inventar claves nuevas sin traducción ni orden pensados. Por eso
// solo hay PATCH (activo), nunca POST: coherente con el grant de la BD, que desde
// 0003 solo permite `update (activo)` sobre esta tabla, nunca insert.
export async function PATCH(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { clave?: string; activo?: boolean };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { clave, activo } = cuerpo;
  if (!clave || activo === undefined) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  const db = await obtenerDb();
  const r = await db.query<{ clave: string; etiqueta: string; activo: boolean }>(
    `update pan.medios_pago set activo = $1 where clave = $2 returning clave, etiqueta, activo`,
    [activo, clave]
  );
  if (!r.rows[0]) return NextResponse.json({ error: "Medio de pago no encontrado" }, { status: 404 });
  return NextResponse.json(r.rows[0]);
}
