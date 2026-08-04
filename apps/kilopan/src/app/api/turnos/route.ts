import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { aEnteroEnRango } from "@/comun/validacion.ts";

// P0-4 (auditoría 1-ago-2026): abre el turno que da el sujeto correcto al cierre de
// caja — ver 0018_turnos_cierre_caja.sql para el porqué. Cualquiera que venda en el
// mesón abre el suyo; el índice único de la BD (un turno abierto por dispositivo)
// es quien de verdad impide dos a la vez, no esta ruta.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "vendedor"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { fondoInicialClp?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const fondoInicialClp = aEnteroEnRango(cuerpo.fondoInicialClp, 0);
  if (fondoInicialClp === null) {
    return NextResponse.json({ error: "Fondo inicial inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const r = await db.query<{ id: string }>(
      `insert into pan.turnos (dispositivo_id, vendedor_id, fondo_inicial_clp)
       values ($1,$2,$3) returning id`,
      [sesion.dispositivoId, sesion.usuarioId, fondoInicialClp]
    );
    return NextResponse.json({ id: r.rows[0]?.id });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/turnos_uno_abierto_por_dispositivo/i.test(mensaje)) {
      return NextResponse.json(
        { error: "Ya hay un turno abierto en este equipo. Ciérralo antes de abrir otro." },
        { status: 409 }
      );
    }
    console.error("POST /api/turnos:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo abrir el turno");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
