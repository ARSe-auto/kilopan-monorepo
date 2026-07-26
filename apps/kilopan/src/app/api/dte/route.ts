import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { validaRut, formatearRut } from "@/comun/valida_rut.ts";

const TIPOS_VALIDOS = [33, 39, 52, 61];

// AC-DTE-01. Esta ruta REGISTRA folios que el SII ya emitió. No emite, no genera
// folios, no crea PDFs con apariencia tributaria (art. 97 N°4 CT). Si algún día
// alguien intenta agregar eso acá, el grep del guardrail y esta nota deberían frenarlo.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const tipoDte = Number(cuerpo.tipoDte);
  const folioSii = Number(cuerpo.folioSii);
  const rutEmisor = String(cuerpo.rutEmisor ?? "");
  const montoTotal = Number(cuerpo.montoTotal);
  const pedidoId = cuerpo.pedidoId ? String(cuerpo.pedidoId) : null;
  const origenCaptura = cuerpo.origenCaptura === "ted_scan" ? "ted_scan" : "manual";

  if (!TIPOS_VALIDOS.includes(tipoDte)) {
    return NextResponse.json({ error: "Tipo de documento inválido (33, 39, 52 o 61)" }, { status: 400 });
  }
  if (!Number.isInteger(folioSii) || folioSii < 1) {
    return NextResponse.json({ error: "Folio inválido" }, { status: 400 });
  }
  if (!validaRut(rutEmisor)) {
    return NextResponse.json({ error: "RUT del emisor inválido" }, { status: 400 });
  }
  if (!Number.isInteger(montoTotal) || montoTotal < 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }
  // Hallazgo menor de la auditoría: sin normalizar, el mismo folio con el RUT del
  // emisor escrito distinto ("76.192.083-9" vs "76192083-9") se cuela dos veces pese
  // al UNIQUE (tipo_dte, folio_sii, rut_emisor).
  const rutEmisorNormalizado = formatearRut(rutEmisor);
  const rutReceptor = cuerpo.rutReceptor ? String(cuerpo.rutReceptor) : null;
  const rutReceptorNormalizado = rutReceptor ? formatearRut(rutReceptor) : null;

  const db = await obtenerDb();
  try {
    const r = await db.query<{ id: string }>(
      `insert into pan.documento_tributario
         (tipo_dte, folio_sii, rut_emisor, rut_receptor, fecha_emision, monto_total,
          origen_captura, ted_xml, ind_traslado, pedido_id, usuario_id, dispositivo_id)
       values ($1,$2,$3,$4, current_date, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        tipoDte,
        folioSii,
        rutEmisorNormalizado,
        rutReceptorNormalizado,
        montoTotal,
        origenCaptura,
        cuerpo.tedXml ? String(cuerpo.tedXml) : null,
        tipoDte === 52 && cuerpo.indTraslado != null ? Number(cuerpo.indTraslado) : null,
        pedidoId,
        sesion.usuarioId,
        sesion.dispositivoId,
      ]
    );
    return NextResponse.json({ id: r.rows[0]?.id });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(mensaje)) {
      return NextResponse.json(
        { error: "Ese folio ya está registrado para este emisor y tipo" },
        { status: 409 }
      );
    }
    if (/sin sesión/i.test(mensaje)) {
      return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
    }
    console.error("POST /api/dte:", mensaje);
    return NextResponse.json({ error: "No se pudo registrar el documento" }, { status: 500 });
  }
}
