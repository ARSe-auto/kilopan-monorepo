import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";

type Fila = {
  fecha: string;
  g_pesados: string;
  g_venta: string;
  g_pod_ok: string;
  g_merma_tipificada: string;
  g_merma_recuperada: string;
  tck: string | null;
};

function esFechaValida(f: string | null): f is string {
  return !!f && /^\d{4}-\d{2}-\d{2}$/.test(f);
}

function aCsv(filas: Fila[]): string {
  const encabezado = "fecha,g_pesados,g_venta,g_pod_ok,g_merma_tipificada,g_merma_recuperada,tck_pct";
  const lineas = filas.map((f) => {
    const tckPct = f.tck == null ? "" : Math.round(Number(f.tck) * 100);
    return [f.fecha, f.g_pesados, f.g_venta, f.g_pod_ok, f.g_merma_tipificada, f.g_merma_recuperada, tckPct].join(",");
  });
  return [encabezado, ...lineas].join("\n");
}

// AC-DASH-09: histórico de pan.conciliacion_diaria por rango de fechas, con exportación
// CSV — sin esto la dueña no puede reconstruir un faltante de una semana atrás sin
// pedirle el dato a alguien con acceso directo a la BD.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  const formato = url.searchParams.get("formato");

  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    return NextResponse.json({ error: "desde y hasta son obligatorios (aaaa-mm-dd)" }, { status: 400 });
  }
  if (desde > hasta) {
    return NextResponse.json({ error: "desde no puede ser posterior a hasta" }, { status: 400 });
  }

  const db = await obtenerDb();
  const r = await db.query<Fila>(
    `select fecha, g_pesados, g_venta, g_pod_ok, g_merma_tipificada, g_merma_recuperada, tck
       from pan.conciliacion_diaria
      where fecha between $1 and $2
      order by fecha desc`,
    [desde, hasta]
  );

  if (formato === "csv") {
    return new NextResponse(aCsv(r.rows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="conciliacion_${desde}_${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({ dias: r.rows });
}
