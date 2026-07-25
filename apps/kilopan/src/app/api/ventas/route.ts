import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

interface LineaEntrada {
  productoId: string;
  gramos: number;
  precioClp: number;
}

// F6 Venta mostrador (PROMPT_MAESTRO.md §5): contra el stock ya pesado.
// Nota de alcance: sin transacción de BD formal todavía (pglite vía query() secuencial)
// — aceptable para este paso del MVP en un solo proceso; un cierre correcto para
// producción envuelve esto en BEGIN/COMMIT o una función SECURITY DEFINER única.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { medioPago?: string; lineas?: LineaEntrada[]; clienteId?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { medioPago, lineas, clienteId } = cuerpo;
  if (!medioPago || !lineas?.length) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  // AC-PAG-02 (decisión #5): el fiado del mesón — el vecino de toda la vida al que se
  // le anota — usa el MISMO cliente y el mismo saldo que el fiado mayorista. Cero
  // segundo sistema de crédito. El CHECK de la BD ya exige el cliente; acá se explica.
  if (medioPago === "fiado" && !clienteId) {
    return NextResponse.json(
      { error: "Para fiar hay que elegir un cliente registrado" },
      { status: 400 }
    );
  }

  const db = await obtenerDb();

  const medio = await db.query<{ clave: string }>(`select clave from pan.medios_pago where clave = $1 and activo`, [
    medioPago,
  ]);
  if (medio.rows.length === 0) {
    return NextResponse.json({ error: "Medio de pago no disponible" }, { status: 400 });
  }

  for (const linea of lineas) {
    if (!linea.productoId || !Number.isInteger(linea.gramos) || linea.gramos < 1) {
      return NextResponse.json({ error: "Línea de venta inválida" }, { status: 400 });
    }
    const stock = await db.query<{ stock: number }>(`select pan.stock_disponible($1) as stock`, [
      linea.productoId,
    ]);
    if ((stock.rows[0]?.stock ?? 0) < linea.gramos) {
      return NextResponse.json(
        { error: `Stock insuficiente (disponible: ${stock.rows[0]?.stock ?? 0} g)` },
        { status: 409 }
      );
    }
  }

  const totalClp = lineas.reduce((suma, l) => suma + l.precioClp, 0);

  try {
    const venta = await db.query<{ id: string }>(
      `insert into pan.ventas (vendedor_id, dispositivo_id, medio_pago, total_clp, cliente_id)
       values ($1,$2,$3,$4,$5) returning id`,
      [sesion.usuarioId, sesion.dispositivoId, medioPago, totalClp, clienteId ?? null]
    );
    const ventaId = venta.rows[0]?.id;
    if (!ventaId) throw new Error("No se pudo crear la venta");

    for (const linea of lineas) {
      await db.query(
        `insert into pan.venta_lineas (venta_id, producto_id, gramos, precio_clp) values ($1,$2,$3,$4)`,
        [ventaId, linea.productoId, linea.gramos, linea.precioClp]
      );
    }
    return NextResponse.json({ id: ventaId, totalClp });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/sin sesión/i.test(mensaje)) {
      return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
    }
    console.error("POST /api/ventas:", mensaje);
    return NextResponse.json({ error: "No se pudo registrar la venta" }, { status: 500 });
  }
}
