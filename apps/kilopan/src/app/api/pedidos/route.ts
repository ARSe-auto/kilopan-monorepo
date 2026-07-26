import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { roundClp } from "@/comun/round_clp.ts";

interface LineaEntrada {
  productoId: string;
  gramosPedidos: number;
}

export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<Record<string, unknown>>(
    `select p.id, p.correlativo_pedido, p.estado, p.fecha_entrega, p.total_clp,
            c.razon_social, c.direccion, c.contacto_nombre,
            (select count(*)::int from pan.documento_tributario d
              where d.pedido_id = p.id and d.estado = 'registrado') as dte_count
       from pan.pedidos p
       join pan.clientes c on c.id = p.cliente_id
      where p.fecha_entrega >= current_date and p.estado <> 'anulado'
      order by p.fecha_entrega, p.correlativo_pedido nulls last`
  );
  return NextResponse.json({ pedidos: r.rows });
}

// F2 Armar pedido (PROMPT_MAESTRO.md §5). El pedido nace en borrador; confirmarlo es
// lo que le asigna correlativo — y eso lo hace SOLO pan.asignar_correlativo().
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { clienteId?: string; fechaEntrega?: string; lineas?: LineaEntrada[] };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { clienteId, fechaEntrega, lineas } = cuerpo;
  if (!clienteId || !fechaEntrega || !lineas?.length) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  const db = await obtenerDb();

  const cliente = await db.query<{ lista_precio: string }>(
    `select lista_precio from pan.clientes where id = $1 and activo`,
    [clienteId]
  );
  const listaPrecio = cliente.rows[0]?.lista_precio;
  if (!listaPrecio) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  try {
    const pedido = await db.query<{ id: string }>(
      `insert into pan.pedidos (cliente_id, fecha_entrega, usuario_id, dispositivo_id)
       values ($1,$2,$3,$4) returning id`,
      [clienteId, fechaEntrega, sesion.usuarioId, sesion.dispositivoId]
    );
    const pedidoId = pedido.rows[0]?.id;
    if (!pedidoId) throw new Error("No se pudo crear el pedido");

    let total = 0;
    for (const linea of lineas) {
      if (!linea.productoId || !Number.isInteger(linea.gramosPedidos) || linea.gramosPedidos < 1) {
        return NextResponse.json({ error: "Línea de pedido inválida" }, { status: 400 });
      }
      // Precio snapshot al confirmar: la lista del cliente, vigente hoy.
      const precio = await db.query<{ precio_clp: number }>(
        `select precio_clp from pan.precios
          where producto_id = $1 and lista = $2 and vigente_desde <= current_date
          order by vigente_desde desc limit 1`,
        [linea.productoId, listaPrecio]
      );
      const precioKg = precio.rows[0]?.precio_clp;
      if (!precioKg) {
        return NextResponse.json({ error: "Producto sin precio en la lista del cliente" }, { status: 400 });
      }
      // roundClp y no Math.round: es la MISMA cuenta que /api/ventas, y ahí el
      // redondeo es bancario (al par en el .5 exacto). Dos reglas distintas para el
      // mismo cálculo hacen que un pedido facturado no cuadre con la venta equivalente
      // por un peso, y esas diferencias aparecen al conciliar sin que nadie sepa de dónde.
      const precioLinea = roundClp((precioKg * linea.gramosPedidos) / 1000);
      total += precioLinea;
      await db.query(
        `insert into pan.pedido_lineas (pedido_id, producto_id, gramos_pedidos, precio_clp) values ($1,$2,$3,$4)`,
        [pedidoId, linea.productoId, linea.gramosPedidos, precioLinea]
      );
    }

    await db.query(`update pan.pedidos set total_clp = $1 where id = $2`, [total, pedidoId]);
    // Confirmar = asignar correlativo. La BD es la única que puede hacerlo.
    const correlativo = await db.query<{ correlativo: string }>(`select pan.asignar_correlativo($1) as correlativo`, [
      pedidoId,
    ]);

    return NextResponse.json({
      id: pedidoId,
      correlativo: correlativo.rows[0]?.correlativo,
      totalClp: total,
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/sin sesión/i.test(mensaje)) {
      return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
    }
    console.error("POST /api/pedidos:", mensaje);
    return NextResponse.json({ error: "No se pudo crear el pedido" }, { status: 500 });
  }
}
