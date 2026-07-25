import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

// AC-FIA-02 (decisión #2). Guías entregadas de un cliente que todavía no están
// cubiertas por ninguna factura — la materia prima del fiado.
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const clienteId = request.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ error: "Falta clienteId" }, { status: 400 });

  const db = await obtenerDb();
  const r = await db.query<Record<string, unknown>>(
    `select d.id, d.tipo_dte, d.folio_sii, d.fecha_emision, d.monto_total, d.estado_pago,
            p.correlativo_pedido
       from pan.documento_tributario d
       join pan.pedidos p on p.id = d.pedido_id
      where p.cliente_id = $1
        and d.tipo_dte = 52          -- guías de despacho
        and d.estado = 'registrado'
        and d.consolidado_en_id is null
      order by d.fecha_emision`,
    [clienteId]
  );
  return NextResponse.json({ guias: r.rows });
}

// Consolidar N guías en UNA factura. La factura la emite el panadero por su vía SII
// de siempre; acá solo se registra su folio y se enlazan las guías que cubre.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador consolida y factura" }, { status: 403 });
  }

  let cuerpo: { guiaIds?: string[]; folioSii?: number; rutEmisor?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { guiaIds, folioSii, rutEmisor } = cuerpo;
  if (!guiaIds?.length || !Number.isInteger(folioSii) || !rutEmisor) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  const db = await obtenerDb();

  // El monto de la factura es la SUMA de las guías que cubre — no un número tecleado
  // aparte que podría no cuadrar con la evidencia.
  const suma = await db.query<{ total: string; n: string; pedido_id: string }>(
    `select coalesce(sum(monto_total),0)::text as total, count(*)::text as n,
            min(pedido_id::text) as pedido_id
       from pan.documento_tributario
      where id = any($1::uuid[]) and consolidado_en_id is null and tipo_dte = 52`,
    [guiaIds]
  );
  const fila = suma.rows[0];
  if (!fila || Number(fila.n) !== guiaIds.length) {
    return NextResponse.json(
      { error: "Alguna guía ya está facturada o no existe" },
      { status: 409 }
    );
  }

  try {
    const factura = await db.query<{ id: string }>(
      `insert into pan.documento_tributario
         (tipo_dte, folio_sii, rut_emisor, fecha_emision, monto_total, origen_captura,
          pedido_id, usuario_id, dispositivo_id)
       values (33, $1, $2, current_date, $3, 'manual', $4, $5, $6) returning id`,
      [folioSii, rutEmisor, Number(fila.total), fila.pedido_id, sesion.usuarioId, sesion.dispositivoId]
    );
    const facturaId = factura.rows[0]?.id;
    if (!facturaId) throw new Error("No se pudo registrar la factura");

    await db.query(
      `update pan.documento_tributario set consolidado_en_id = $1
        where id = any($2::uuid[]) and consolidado_en_id is null`,
      [facturaId, guiaIds]
    );

    return NextResponse.json({ facturaId, guiasConsolidadas: guiaIds.length, montoTotal: Number(fila.total) });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(mensaje)) {
      return NextResponse.json({ error: "Ese folio de factura ya está registrado" }, { status: 409 });
    }
    console.error("POST /api/facturar:", mensaje);
    return NextResponse.json({ error: "No se pudo consolidar" }, { status: 500 });
  }
}

// Marcar pagada — cierra el ciclo del fiado.
export async function PATCH(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador marca pagos" }, { status: 403 });
  }

  let cuerpo: { facturaId?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!cuerpo.facturaId) return NextResponse.json({ error: "Falta facturaId" }, { status: 400 });

  const db = await obtenerDb();
  const r = await db.query<{ id: string }>(
    `update pan.documento_tributario set estado_pago = 'pagada'
      where id = $1 and estado_pago = 'pendiente' returning id`,
    [cuerpo.facturaId]
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "Ya estaba pagada o no existe" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
