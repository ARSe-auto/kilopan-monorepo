import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-ADM-09 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): quitar un pedido
// de una ruta desde /arreglar. SOLO admin —toda la superficie de /arreglar lo es (§5)— y
// el rechazo lo decide el SERVIDOR, no un enlace escondido (misma lección que
// pesaje_foto_obligatoria).
//
// Por qué hizo falta una migración (0025, nota de archivo del plan): reusar 'rechazada'
// mentiría —esa es la reservada para un rechazo REAL del cliente en el POD, catálogo
// cerrado de AC-POD-05— y pan.ruta_paradas nunca tuvo grant `delete` (0004, solo `insert,
// update`), así que "quitar" tampoco puede ser un DELETE. `estado='quitada'` es el estado
// nuevo que cierra el CHECK, append-only como el resto de esta sección.
//
// Se identifica por (rutaId, pedidoId) y no por el id crudo de la parada: no existe
// ningún GET que exponga ruta_paradas.id por HTTP (mismo patrón que AC-ADM-06 con el id
// del cierre de turno) — el admin sí conoce a qué pedido y a qué ruta se refiere.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador quita un pedido de una ruta" }, { status: 403 });
  }

  let cuerpo: { rutaId?: string; pedidoId?: string; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!cuerpo.rutaId || !esUuid(cuerpo.rutaId)) {
    return NextResponse.json({ error: "Falta rutaId" }, { status: 400 });
  }
  if (!cuerpo.pedidoId || !esUuid(cuerpo.pedidoId)) {
    return NextResponse.json({ error: "Falta pedidoId" }, { status: 400 });
  }
  // El motivo se valida en el SERVIDOR: pedirlo solo en la pantalla es teatro de cliente
  // (misma lección que pesaje_foto_obligatoria). Sin CHECK que lo respalde en la BD
  // porque pan.ruta_paradas no gana columna nueva para esto — el motivo vive en el
  // evento, que ya es append-only.
  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ error: "Escribe el motivo para quitar el pedido de la ruta" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const resultado = await db.transaccion(async (tx) => {
      // `for update` fija la fila mientras se decide, mismo patrón que /api/rutas/cerrar:
      // un doble-tap casi simultáneo no puede quitar la misma parada dos veces.
      const previa = await tx.query<{ id: string; estado: string }>(
        `select id, estado from pan.ruta_paradas where ruta_id = $1 and pedido_id = $2 for update`,
        [cuerpo.rutaId, cuerpo.pedidoId]
      );
      const fila = previa.rows[0];
      if (!fila) return "no_existe" as const;
      // Solo tiene sentido quitar una parada que TODAVÍA no se resolvió: una ya
      // entregada, rechazada o quitada no es "un error de asignación" por deshacer.
      if (fila.estado !== "pendiente") return "no_pendiente" as const;

      await tx.query(`update pan.ruta_paradas set estado = 'quitada' where id = $1`, [fila.id]);
      // El pedido vuelve a 'confirmado' — mismo destino que una entrega fallida
      // (apps/kilopan/src/app/api/sync/route.ts) — para que pueda armarse en OTRA ruta
      // más adelante, en vez de quedar huérfano en 'en_ruta' para siempre.
      await tx.query(
        `update pan.pedidos set estado = 'confirmado' where id = $1 and estado = 'en_ruta'`,
        [cuerpo.pedidoId]
      );
      await registrarEvento(
        tx,
        "parada_quitada",
        "ruta_paradas",
        fila.id,
        { motivo, rutaId: cuerpo.rutaId, pedidoId: cuerpo.pedidoId },
        sesion
      );
      return { id: fila.id };
    });

    if (resultado === "no_existe") {
      return NextResponse.json({ error: "Ese pedido no es una parada de esa ruta" }, { status: 404 });
    }
    if (resultado === "no_pendiente") {
      return NextResponse.json(
        { error: "Esa parada ya no está pendiente — no se puede quitar" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    console.error("POST /api/rutas/paradas/quitar:", err instanceof Error ? err.message : String(err));
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo quitar el pedido de la ruta");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
