import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion, exigirRol } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-FIA-02 (decisión #2). Guías entregadas de un cliente que todavía no están
// cubiertas por ninguna factura — la materia prima del fiado. Solo /facturar la
// consulta y esa pantalla es admin-only.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const clienteId = request.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ error: "Falta clienteId" }, { status: 400 });
  if (!esUuid(clienteId)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });

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
  if (guiaIds?.length && !guiaIds.every((id) => esUuid(id))) {
    return NextResponse.json({ error: "Guía inválida" }, { status: 400 });
  }
  if (!guiaIds?.length || !rutEmisor) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  // Antes esto caía en "Faltan campos" cuando el folio no era un entero (por ejemplo
  // "123.456" con el punto de miles chileno) — mismo mensaje que si de verdad faltara,
  // sin decir qué corregir. También faltaba el mismo piso que ya tiene /api/dte.
  if (folioSii == null || !Number.isInteger(folioSii) || folioSii < 1) {
    return NextResponse.json({ error: "Folio inválido" }, { status: 400 });
  }

  const db = await obtenerDb();

  try {
    // Todo en UNA transacción, con `for update` sobre las guías: antes eran dos
    // queries sueltas (leer el total, después consolidar) sin nada que impidiera que
    // dos clics — o dos admins — consolidaran la MISMA guía dos veces entre una y
    // otra. El `for update` bloquea esas filas hasta el commit; si una segunda
    // transacción llega a pedir las mismas guías, espera y las encuentra ya tomadas.
    const resultado = await db.transaccion(async (tx) => {
      const guias = await tx.query<{ id: string; monto_total: number; pedido_id: string; cliente_id: string }>(
        `select d.id, d.monto_total, d.pedido_id, p.cliente_id
           from pan.documento_tributario d
           join pan.pedidos p on p.id = d.pedido_id
          where d.id = any($1::uuid[]) and d.consolidado_en_id is null and d.tipo_dte = 52
          for update of d`,
        [guiaIds]
      );
      if (guias.rows.length !== guiaIds.length) {
        throw new Error("guias_no_disponibles");
      }
      // Hallazgo menor de la auditoría: nada impedía consolidar guías de CLIENTES
      // distintos en una sola factura — el monto quedaba bien sumado, pero atribuido
      // al cliente de la primera guía nomás, mientras las otras se daban por pagadas
      // sin estarlo.
      const clienteId = guias.rows[0]!.cliente_id;
      if (guias.rows.some((g) => g.cliente_id !== clienteId)) {
        throw new Error("clientes_mezclados");
      }
      // El monto de la factura es la SUMA de las guías que cubre — no un número
      // tecleado aparte que podría no cuadrar con la evidencia.
      const total = guias.rows.reduce((s, g) => s + Number(g.monto_total), 0);
      const pedidoId = guias.rows[0]!.pedido_id;

      const factura = await tx.query<{ id: string }>(
        `insert into pan.documento_tributario
           (tipo_dte, folio_sii, rut_emisor, fecha_emision, monto_total, origen_captura,
            pedido_id, usuario_id, dispositivo_id)
         values (33, $1, $2, current_date, $3, 'manual', $4, $5, $6) returning id`,
        [folioSii, rutEmisor, total, pedidoId, sesion.usuarioId, sesion.dispositivoId]
      );
      const facturaId = factura.rows[0]?.id;
      if (!facturaId) throw new Error("No se pudo registrar la factura");

      await tx.query(`update pan.documento_tributario set consolidado_en_id = $1 where id = any($2::uuid[])`, [
        facturaId,
        guiaIds,
      ]);

      return { facturaId, total };
    });

    return NextResponse.json({
      facturaId: resultado.facturaId,
      guiasConsolidadas: guiaIds.length,
      montoTotal: resultado.total,
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje === "guias_no_disponibles") {
      return NextResponse.json(
        { error: "Alguna guía ya está facturada o no existe" },
        { status: 409 }
      );
    }
    if (mensaje === "clientes_mezclados") {
      return NextResponse.json(
        { error: "Las guías elegidas son de clientes distintos" },
        { status: 400 }
      );
    }
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
