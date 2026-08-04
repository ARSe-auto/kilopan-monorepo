import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { validaRut, formatearRut } from "@/comun/valida_rut.ts";
import { aEnteroEstricto, aEnteroEnRango, esUuid } from "@/comun/validacion.ts";

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

  // aEnteroEnRango y no Number(): `Number("25.000")` es 25 y pasaba
  // `Number.isInteger`, así que una guía de $25.000 tecleada con el punto de miles
  // chileno se registraba como $25 — subdeclaración de 1000x ante el SII y la deuda
  // del cliente desaparecía del fiado, en silencio (red-team, ALTA).
  const tipoDte = aEnteroEstricto(cuerpo.tipoDte);
  const folioSii = aEnteroEnRango(cuerpo.folioSii, 1);
  const rutEmisor = String(cuerpo.rutEmisor ?? "");
  // Mínimo 1, no 0: un documento tributario por $0 no existe. Antes se aceptaba
  // (el guard solo miraba `< 0`), incoherente con el folio que sí exigía >= 1, y el
  // monto en blanco de la pantalla de despacho entraba como $0.
  const montoTotal = aEnteroEnRango(cuerpo.montoTotal, 1);
  const pedidoId = cuerpo.pedidoId ? String(cuerpo.pedidoId) : null;
  const origenCaptura = cuerpo.origenCaptura === "ted_scan" ? "ted_scan" : "manual";

  if (tipoDte === null || !TIPOS_VALIDOS.includes(tipoDte)) {
    return NextResponse.json({ error: "Tipo de documento inválido (33, 39, 52 o 61)" }, { status: 400 });
  }
  if (folioSii === null) {
    return NextResponse.json({ error: "Folio inválido" }, { status: 400 });
  }
  if (!validaRut(rutEmisor)) {
    return NextResponse.json({ error: "RUT del emisor inválido" }, { status: 400 });
  }
  if (montoTotal === null) {
    return NextResponse.json(
      { error: "Monto inválido: escribe solo números, sin puntos ni comas" },
      { status: 400 }
    );
  }
  if (pedidoId !== null && !esUuid(pedidoId)) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }
  // Hallazgo menor de la auditoría: sin normalizar, el mismo folio con el RUT del
  // emisor escrito distinto ("76.192.083-9" vs "76192083-9") se cuela dos veces pese
  // al UNIQUE (tipo_dte, folio_sii, rut_emisor).
  const rutEmisorNormalizado = formatearRut(rutEmisor);
  const rutReceptor = cuerpo.rutReceptor ? String(cuerpo.rutReceptor) : null;
  // Antes el receptor no se validaba: un RUT basura llegaba al CHECK de la BD y
  // salía como 500 crudo en vez de un 400 que le diga al panadero qué corregir.
  if (rutReceptor !== null && !validaRut(rutReceptor)) {
    return NextResponse.json({ error: "RUT del receptor inválido" }, { status: 400 });
  }
  const rutReceptorNormalizado = rutReceptor ? formatearRut(rutReceptor) : null;

  // IndTraslado del SII tiene dominio 1..9 (venta, traslado interno, consignación…).
  // Se aceptaba 999 y -5, dejando metadata tributaria inválida en la guía.
  let indTraslado: number | null = null;
  if (tipoDte === 52 && cuerpo.indTraslado != null) {
    indTraslado = aEnteroEnRango(cuerpo.indTraslado, 1, 9);
    if (indTraslado === null) {
      return NextResponse.json({ error: "Indicador de traslado inválido (1 a 9)" }, { status: 400 });
    }
  }

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
        indTraslado,
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
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo registrar el documento");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
