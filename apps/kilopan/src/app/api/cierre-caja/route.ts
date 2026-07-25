import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

// AC-VEN-01 + AC-PAG-01: el cierre de caja pasa de un par esperado/declarado a UNA
// FILA POR MEDIO DE PAGO activo — porque ahora la panadería cobra por 8 vías, no 2.
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<{ medio_pago: string; etiqueta: string; esperado_clp: string }>(
    `select mp.clave as medio_pago, mp.etiqueta,
            coalesce(sum(v.total_clp), 0)::text as esperado_clp
       from pan.medios_pago mp
       left join pan.ventas v
              on v.medio_pago = mp.clave
             and v.creado_at::date = current_date
             and v.vendedor_id = $1
      where mp.activo
      group by mp.clave, mp.etiqueta, mp.orden
      order by mp.orden`,
    [sesion.usuarioId]
  );
  return NextResponse.json({ medios: r.rows });
}

export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: {
    declarados?: { medioPago: string; declaradoClp: number }[];
    totalFacturadorClp?: number | null;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const declarados = cuerpo.declarados ?? [];
  if (declarados.length === 0) {
    return NextResponse.json({ error: "Nada que cerrar" }, { status: 400 });
  }

  const db = await obtenerDb();
  const resultado: { medioPago: string; esperado: number; declarado: number; diferencia: number }[] = [];

  for (const d of declarados) {
    if (!Number.isInteger(d.declaradoClp) || d.declaradoClp < 0) {
      return NextResponse.json({ error: "Monto declarado inválido" }, { status: 400 });
    }
    const esperado = await db.query<{ esperado: string }>(
      `select coalesce(sum(total_clp), 0)::text as esperado from pan.ventas
        where medio_pago = $1 and creado_at::date = current_date and vendedor_id = $2`,
      [d.medioPago, sesion.usuarioId]
    );
    const esperadoClp = Number(esperado.rows[0]?.esperado ?? 0);

    await db.query(
      `insert into pan.cierres_caja
         (dispositivo_id, vendedor_id, medio_pago, esperado_clp, declarado_clp, total_facturador_clp)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        sesion.dispositivoId,
        sesion.usuarioId,
        d.medioPago,
        esperadoClp,
        d.declaradoClp,
        // AC-DASH-04 (decisión #3, fase 1): el total que marcó el facturador se teclea
        // UNA vez y se compara. La fase 2 lo reemplaza por subir el CSV del día; la
        // fase 3 (API) solo si el piloto de Indupan lo pide.
        cuerpo.totalFacturadorClp ?? null,
      ]
    );
    resultado.push({
      medioPago: d.medioPago,
      esperado: esperadoClp,
      declarado: d.declaradoClp,
      diferencia: d.declaradoClp - esperadoClp,
    });
  }

  const totalEsperado = resultado.reduce((s, r) => s + r.esperado, 0);
  return NextResponse.json({
    resultado,
    totalEsperado,
    diferenciaFacturador:
      cuerpo.totalFacturadorClp != null ? cuerpo.totalFacturadorClp - totalEsperado : null,
  });
}
