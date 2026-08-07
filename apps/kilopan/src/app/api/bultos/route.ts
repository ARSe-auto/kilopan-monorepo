import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-DES-05: contador N/M de F3 — cuántos bultos de la ruta ya se escanearon. Admin ve
// cualquier ruta; el repartidor solo la suya (mismo filtro que GET /api/rutas).
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "repartidor"]);
  if (sesion instanceof NextResponse) return sesion;

  const rutaId = request.nextUrl.searchParams.get("rutaId");
  if (!rutaId || !esUuid(rutaId)) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 });
  }

  const db = await obtenerDb();
  const ruta = await db.query(
    `select id from pan.rutas where id = $1 and fecha = current_date and ($2 = 'admin' or repartidor_id = $3)`,
    [rutaId, sesion.rol, sesion.usuarioId]
  );
  if (ruta.rows.length === 0) {
    return NextResponse.json({ error: "Ruta no encontrada" }, { status: 404 });
  }

  const r = await db.query<{
    id: string;
    codigo: string;
    correlativo: number;
    cargado: boolean;
    correlativo_pedido: string;
    razon_social: string;
  }>(
    `select b.id, b.codigo, b.correlativo, (b.cargado_at is not null) as cargado,
            p.correlativo_pedido, c.razon_social
       from pan.bultos b
       join pan.ruta_paradas rp on rp.pedido_id = b.pedido_id and rp.ruta_id = $1
       join pan.pedidos p on p.id = b.pedido_id
       join pan.clientes c on c.id = p.cliente_id
      order by p.correlativo_pedido nulls last, b.correlativo`,
    [rutaId]
  );
  const cargados = r.rows.filter((b) => b.cargado === true).length;
  return NextResponse.json({ bultos: r.rows, cargados, total: r.rows.length });
}

// AC-DES-05: el escaneo de F3. pan.cargar_bulto() rebota «ya escaneado» sobre un bulto
// repetido — acá se traduce a 409 para que la pantalla pinte el banner ámbar de duplicado.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "repartidor"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { codigo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const codigo = typeof cuerpo.codigo === "string" ? cuerpo.codigo.trim() : "";
  if (!codigo) {
    return NextResponse.json({ error: "Falta el código del bulto" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const r = await db.query<{ id: string }>(`select pan.cargar_bulto($1, $2, $3) as id`, [
      codigo,
      sesion.usuarioId,
      sesion.dispositivoId,
    ]);
    return NextResponse.json({ id: r.rows[0]?.id, codigo });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/ya escaneado/i.test(mensaje)) {
      return NextResponse.json({ error: "Bulto ya escaneado", motivo: "duplicado", codigo }, { status: 409 });
    }
    if (/no existe/i.test(mensaje)) {
      return NextResponse.json(
        { error: "Ese código no corresponde a ningún bulto", motivo: "desconocido", codigo },
        { status: 404 }
      );
    }
    console.error("POST /api/bultos:", mensaje);
    const clasificado = clasificarError(err, "No se pudo cargar el bulto");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
