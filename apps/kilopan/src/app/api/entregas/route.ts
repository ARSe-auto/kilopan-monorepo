import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";

const POR_PAGINA = 50;

// AC-PERF-03: paginación por cursor (keyset), NO por OFFSET. Con OFFSET, la página
// 40 del historial de auditoría obliga a Postgres a recorrer y descartar 2.000 filas;
// con keyset el costo es constante y el índice de `recibido_at` hace todo el trabajo.
// Además el cursor no se "corre" si entra una entrega nueva mientras el dueño scrollea.
// Es la cola "Entregas por revisar" del dueño: nadie más la consulta hoy.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const cursor = request.nextUrl.searchParams.get("cursor"); // recibido_at de la última fila vista
  const soloPorRevisar = request.nextUrl.searchParams.get("porRevisar") === "1";

  const db = await obtenerDb();
  try {
    const r = await db.query<Record<string, unknown>>(
      // `es_parcial`: se entregó MENOS de lo que el pedido pedía. Entra a la cola de
      // revisión igual que un GPS degradado — antes una parcial ínfima (1 g de 10.000)
      // cerraba el pedido como 'entregado' y no aparecía en ninguna parte: el cliente
      // se quedaba sin su pan y nadie lo conciliaba (red-team).
      `select e.id, e.receptor_nombre, e.gramos_entregados, e.foto_sha256, e.foto_estado,
              e.gps_degradado, e.gps_fuera_de_zona, e.recibido_at, e.capturado_at,
              c.razon_social, p.correlativo_pedido,
              coalesce(e.gramos_entregados < ped.gramos_pedidos, false) as es_parcial,
              ped.gramos_pedidos
         from pan.entregas e
         join pan.pedidos p on p.id = e.pedido_id
         join pan.clientes c on c.id = p.cliente_id
         left join lateral (
           select coalesce(sum(pl.gramos_pedidos), 0)::int as gramos_pedidos
             from pan.pedido_lineas pl where pl.pedido_id = e.pedido_id
         ) ped on true
        where e.cerrada and e.supersede_id is null
          and ($1::timestamptz is null or e.recibido_at < $1)
          and ($2 = false or e.gps_degradado or e.gps_fuera_de_zona
               or e.foto_estado = 'pendiente_subida'
               or e.gramos_entregados < ped.gramos_pedidos)
        order by e.recibido_at desc
        limit ${POR_PAGINA + 1}`,
      [cursor, soloPorRevisar]
    );

    // Se pide una fila de más para saber si hay página siguiente sin un COUNT(*) aparte.
    const hayMas = r.rows.length > POR_PAGINA;
    const entregas = hayMas ? r.rows.slice(0, POR_PAGINA) : r.rows;
    const ultima = entregas[entregas.length - 1] as { recibido_at?: string } | undefined;

    return NextResponse.json({
      entregas,
      proximoCursor: hayMas && ultima?.recibido_at ? ultima.recibido_at : null,
    });
  } catch (err) {
    // Antes un cursor malformado (no parseable como timestamptz) reventaba sin
    // capturar y devolvía el error crudo del driver de Postgres en un 500.
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("GET /api/entregas:", mensaje);
    return NextResponse.json({ error: "Cursor inválido" }, { status: 400 });
  }
}
