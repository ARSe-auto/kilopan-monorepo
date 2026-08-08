import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-MERM-02 (specs/kilopan/02-catalogo-pesaje.md): UI de resolución de mermas al día
// siguiente. La máquina de estados existe en BD (AC-MERM-01), pero ninguna pantalla
// permite cambiar estado_merma de 'pendiente' a 'recuperada_con_venta'.
//
// Solo admin y maestro (quien pesó) pueden resolver la merma. El cambio de estado lo
// audita el servidor: `estado_merma` cambia y se registra el evento.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (!["admin", "maestro"].includes(sesion.rol)) {
    return NextResponse.json({ error: "No tienes permisos para resolver mermas" }, { status: 403 });
  }

  let cuerpo: { pesajeId?: string; nuevoEstado?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { pesajeId, nuevoEstado } = cuerpo;

  if (!pesajeId || !esUuid(pesajeId)) {
    return NextResponse.json({ error: "Falta pesajeId o es inválido" }, { status: 400 });
  }
  if (!nuevoEstado || !["confirmada_perdida", "recuperada_con_venta"].includes(nuevoEstado)) {
    return NextResponse.json(
      { error: "nuevoEstado debe ser 'confirmada_perdida' o 'recuperada_con_venta'" },
      { status: 400 }
    );
  }

  const db = await obtenerDb();
  try {
    const resultado = await db.transaccion(async (tx) => {
      const previa = await tx.query<{
        id: string;
        estado_merma: string;
        destino: string;
        usuario_id: string;
      }>(
        `select id, estado_merma, destino, usuario_id from pan.pesajes where id = $1 for update`,
        [pesajeId]
      );
      const fila = previa.rows[0];
      if (!fila) return "no_existe" as const;
      if (fila.destino !== "merma") return "no_es_merma" as const;
      if (fila.estado_merma !== "pendiente") return "no_pendiente" as const;

      // Un maestro solo puede resolver su propia merma
      if (sesion.rol === "maestro" && fila.usuario_id !== sesion.usuarioId) {
        return "no_pertenece" as const;
      }

      const upd = await tx.query<{ id: string }>(
        `update pan.pesajes set estado_merma = $2 where id = $1 returning id`,
        [pesajeId, nuevoEstado]
      );
      const actualizado = upd.rows[0]!.id;
      await registrarEvento(tx, "merma_resuelta", "pesajes", actualizado, { nuevoEstado }, sesion);
      return { id: actualizado };
    });

    if (resultado === "no_existe") {
      return NextResponse.json({ error: "La merma no existe" }, { status: 404 });
    }
    if (resultado === "no_es_merma") {
      return NextResponse.json({ error: "Este pesaje no es una merma" }, { status: 400 });
    }
    if (resultado === "no_pendiente") {
      return NextResponse.json({ error: "Esta merma ya fue resuelta" }, { status: 409 });
    }
    if (resultado === "no_pertenece") {
      return NextResponse.json({ error: "No puedes resolver una merma que no pesaste" }, { status: 403 });
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    const clasificado = clasificarError(err, "No se pudo resolver la merma");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
