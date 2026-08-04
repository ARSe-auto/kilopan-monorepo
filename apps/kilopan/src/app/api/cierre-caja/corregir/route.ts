import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid, aEnteroEnRango } from "@/comun/validacion.ts";

// AC-ADM-06 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): corregir un
// cierre de turno desde /arreglar. SOLO admin, y el rechazo lo decide el SERVIDOR (misma
// lección que pesaje_foto_obligatoria y AC-ADM-05).
//
// Exige un motivo escrito y no vacío (regla transversal de la sección). El cierre
// original NO se toca: se inserta una fila nueva con supersede_id apuntando a la
// original (mismo patrón que pan.entregas/POD, 0004) — un UPDATE directo ya está
// bloqueado en la BD por trg_cierres_caja_inmutable (0023), así que aunque este endpoint
// tuviera un bug, la BD igual lo rechaza.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador corrige un cierre de turno" }, { status: 403 });
  }

  let cuerpo: { cierreCajaId?: string; declaradoClp?: number; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!cuerpo.cierreCajaId || !esUuid(cuerpo.cierreCajaId)) {
    return NextResponse.json({ error: "Falta cierreCajaId" }, { status: 400 });
  }
  const declaradoClp = aEnteroEnRango(cuerpo.declaradoClp, 0);
  if (declaradoClp === null) {
    return NextResponse.json({ error: "Monto declarado inválido" }, { status: 400 });
  }
  // El motivo se valida en el SERVIDOR: pedirlo solo en la pantalla es teatro de
  // cliente. El CHECK cierres_caja_correccion_exige_motivo (0023) lo respalda por si
  // alguien entra por otra vía.
  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ error: "Escribe el motivo de la corrección" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const resultado = await db.transaccion(async (tx) => {
      const original = await tx.query<{
        id: string;
        dispositivo_id: string;
        vendedor_id: string;
        fecha: string;
        medio_pago: string;
        esperado_clp: number;
        declarado_clp: number;
        total_facturador_clp: number | null;
        turno_id: string | null;
      }>(
        `select id, dispositivo_id, vendedor_id, fecha, medio_pago, esperado_clp,
                declarado_clp, total_facturador_clp, turno_id
           from pan.cierres_caja where id = $1`,
        [cuerpo.cierreCajaId]
      );
      const fila = original.rows[0];
      if (!fila) return null;

      // La corrección conserva el esperado calculado en el cierre original (es lo que
      // la BD sabía en ese momento) y el medio de pago/turno al que pertenece; lo único
      // que cambia es lo declarado, que es justamente lo que un vendedor puede teclear
      // mal al contar la plata.
      const correccion = await tx.query<{ id: string }>(
        `insert into pan.cierres_caja
           (dispositivo_id, vendedor_id, fecha, medio_pago, esperado_clp, declarado_clp,
            total_facturador_clp, turno_id, supersede_id, correccion_motivo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id`,
        [
          fila.dispositivo_id,
          fila.vendedor_id,
          fila.fecha,
          fila.medio_pago,
          fila.esperado_clp,
          declaradoClp,
          fila.total_facturador_clp,
          fila.turno_id,
          fila.id,
          motivo,
        ]
      );
      const correccionId = correccion.rows[0]!.id;
      // AC-ADM-10: mismo catálogo compartido que el resto de las operaciones de plata.
      await registrarEvento(tx, "cierre_caja_corregido", "cierres_caja", fila.id, {
        motivo,
        correccionId,
        declaradoClpAnterior: fila.declarado_clp,
        declaradoClpNuevo: declaradoClp,
      }, sesion);
      return { id: correccionId };
    });
    if (!resultado) {
      return NextResponse.json({ error: "El cierre no existe" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/cierres_caja_una_correccion_por_original/i.test(mensaje)) {
      return NextResponse.json({ error: "Este cierre ya fue corregido antes" }, { status: 409 });
    }
    console.error("POST /api/cierre-caja/corregir:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo corregir el cierre");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
