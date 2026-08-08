import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid, MAX_LARGO_MOTIVO } from "@/comun/validacion.ts";

// AC-ADM-05 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): anular una venta
// desde /arreglar. SOLO admin —toda la superficie de /arreglar lo es (§5)— y el rechazo lo
// decide el SERVIDOR, no un enlace escondido (misma lección que pesaje_foto_obligatoria).
//
// Exige un motivo escrito y no vacío: la regla transversal de la sección es que toda acción
// destructiva se confirma ESCRIBIENDO el porqué —jamás marcando una casilla que se marca sin
// leer—. Marca la venta anulada (deja de sumar al arqueo de su turno; ver /api/cierre-caja)
// SIN borrarla ni reescribir su monto (append-only), y deja su evento en pan.eventos con
// quién, cuándo y en qué equipo se hizo la anulación.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador anula una venta" }, { status: 403 });
  }

  let cuerpo: { ventaId?: string; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!cuerpo.ventaId || !esUuid(cuerpo.ventaId)) {
    return NextResponse.json({ error: "Falta ventaId" }, { status: 400 });
  }
  // El motivo se valida en el SERVIDOR: pedirlo solo en la pantalla es teatro de cliente.
  // El CHECK ventas_anulada_exige_motivo (0020) lo respalda por si alguien entra por otra vía.
  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ error: "Escribe el motivo de la anulación" }, { status: 400 });
  }
  // AC-SEC-09: el CHECK ventas_anulada_exige_motivo (0020) exige no-vacío, pero ninguna
  // capa topaba el largo — `anulada_motivo` es `text` sin límite.
  if (motivo.length > MAX_LARGO_MOTIVO) {
    return NextResponse.json(
      { error: `El motivo no puede superar los ${MAX_LARGO_MOTIVO} caracteres` },
      { status: 400 }
    );
  }

  const db = await obtenerDb();
  try {
    // La marca en la venta y el evento entran JUNTOS: una anulación sin su evento —o un
    // evento sin la anulación efectiva— rompe justo la auditoría que este AC existe para
    // garantizar. El `where anulada_at is null` hace idempotente el doble-tap: la segunda
    // no actualiza fila y no dispara un segundo evento.
    const resultado = await db.transaccion(async (tx) => {
      const upd = await tx.query<{ id: string }>(
        `update pan.ventas
            set anulada_at = now(), anulada_motivo = $2
          where id = $1 and anulada_at is null
          returning id`,
        [cuerpo.ventaId, motivo]
      );
      const venta = upd.rows[0];
      if (!venta) return null; // no existe o ya estaba anulada
      // AC-ADM-10: migrado del insert a mano al catálogo compartido. El SQL era correcto,
      // pero con el nombre del tipo suelto en un string: dos rutas escribiendo
      // 'venta_anulada' y 'venta_anulacion' dejan una auditoría que no se puede consultar.
      await registrarEvento(tx, "venta_anulada", "ventas", venta.id, { motivo }, sesion);
      return venta;
    });
    if (!resultado) {
      return NextResponse.json({ error: "La venta no existe o ya estaba anulada" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    console.error("POST /api/ventas/anular:", err instanceof Error ? err.message : String(err));
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo anular la venta");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
