import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<{ clave: string; valor: number; descripcion: string }>(
    `select clave, valor, descripcion from pan.parametros order by clave`
  );
  return NextResponse.json({ parametros: r.rows });
}

// AC-PES-04: el toggle de foto obligatoria en pesaje lo prende SOLO un admin —
// nunca quien pesa. Ese es el punto entero de la decisión #1: es un control del
// dueño sobre su operación, no una carga que el maestro se pueda sacar de encima.
export async function PATCH(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador cambia estos ajustes" }, { status: 403 });
  }

  let cuerpo: { clave?: string; valor?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { clave, valor } = cuerpo;
  if (!clave || valor == null || !Number.isInteger(valor)) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  // El servidor es el que manda, no la pantalla: un ajuste negativo (o un 0 colado por
  // un campo vaciado sin querer) alimenta directo el $/km del panel del dueño.
  if (valor < 0) {
    return NextResponse.json({ error: "El valor no puede ser negativo" }, { status: 400 });
  }

  const db = await obtenerDb();
  const r = await db.query<{ clave: string }>(
    `update pan.parametros set valor = $1 where clave = $2 returning clave`,
    [valor, clave]
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "Ese ajuste no existe" }, { status: 404 });
  }

  await db.query(
    `insert into pan.eventos (tipo, entidad, payload, usuario_id, dispositivo_id)
     values ('parametro_cambiado', 'parametros', $1, $2, $3)`,
    [JSON.stringify({ clave, valor }), sesion.usuarioId, sesion.dispositivoId]
  );
  return NextResponse.json({ clave, valor });
}
