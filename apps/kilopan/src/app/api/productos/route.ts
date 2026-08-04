import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion, exigirRol } from "@/identidad/sesion.ts";

export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const detalle = request.nextUrl.searchParams.get("detalle") === "1";

  // `?detalle=1` es para /admin: ahí hace falta ver los inactivos (para poder
  // reactivarlos) y el precio mayorista además del de mostrador.
  if (detalle) {
    if (sesion.rol !== "admin") return NextResponse.json({ error: "Solo un administrador" }, { status: 403 });
    const r = await db.query<{
      id: string;
      nombre: string;
      tipo_venta: string;
      activo: boolean;
      precio_mostrador_clp: number | null;
      precio_mayorista_clp: number | null;
    }>(`
      select p.id, p.nombre, p.tipo_venta, p.activo,
             (select precio_clp from pan.precios
               where producto_id = p.id and lista = 'mostrador' and vigente_desde <= current_date
               order by vigente_desde desc limit 1) as precio_mostrador_clp,
             (select precio_clp from pan.precios
               where producto_id = p.id and lista = 'mayorista' and vigente_desde <= current_date
               order by vigente_desde desc limit 1) as precio_mayorista_clp
        from pan.productos p
       order by p.activo desc, p.nombre
    `);
    return NextResponse.json({ productos: r.rows });
  }

  // AC-PES-07 (§5 F1): la grilla de /pesar ordena por frecuencia REAL de pesaje —
  // repetir el producto de siempre cuesta 2 toques solo si ese producto está arriba.
  // El conteo es histórico completo (no una ventana): un pan que se pesa todos los
  // días acumula más pesajes que uno que se pesa una vez al mes, y el orden lo refleja
  // solo. Empate (incluido 0 pesajes, p.ej. un producto recién dado de alta) cae a
  // alfabético para que la grilla no "baile" sin motivo entre cargas.
  const r = await db.query<{
    id: string;
    nombre: string;
    tipo_venta: string;
    precio_mostrador_clp: number | null;
    stock_disponible_g: number;
  }>(`
    select p.id, p.nombre, p.tipo_venta,
           (select precio_clp from pan.precios
             where producto_id = p.id and lista = 'mostrador' and vigente_desde <= current_date
             order by vigente_desde desc limit 1) as precio_mostrador_clp,
           pan.stock_disponible(p.id) as stock_disponible_g
      from pan.productos p
      left join (
        select producto_id, count(*) as frecuencia
          from pan.pesajes
         group by producto_id
      ) f on f.producto_id = p.id
     where p.activo
     order by coalesce(f.frecuencia, 0) desc, p.nombre
  `);
  return NextResponse.json({ productos: r.rows });
}

// AC-ADM-02: dar de alta pan nuevo desde la propia app — hasta ahora era otro
// bloqueador de producto que solo un SQL directo podía resolver.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { nombre?: string; tipoVenta?: string; precioMostradorClp?: number; precioMayoristaClp?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { nombre, tipoVenta, precioMostradorClp, precioMayoristaClp } = cuerpo;
  if (!nombre?.trim() || !tipoVenta) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (tipoVenta !== "kilo" && tipoVenta !== "unidad") {
    return NextResponse.json({ error: "Tipo de venta inválido" }, { status: 400 });
  }
  if (precioMostradorClp == null || !Number.isInteger(precioMostradorClp) || precioMostradorClp <= 0) {
    return NextResponse.json({ error: "Precio de mostrador inválido" }, { status: 400 });
  }
  if (
    precioMayoristaClp != null &&
    (!Number.isInteger(precioMayoristaClp) || precioMayoristaClp <= 0)
  ) {
    return NextResponse.json({ error: "Precio mayorista inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const id = await db.transaccion(async (tx) => {
      const producto = await tx.query<{ id: string }>(
        `insert into pan.productos (nombre, tipo_venta) values ($1,$2) returning id`,
        [nombre.trim(), tipoVenta]
      );
      const productoId = producto.rows[0]?.id;
      if (!productoId) throw new Error("No se pudo crear el producto");
      await tx.query(
        `insert into pan.precios (producto_id, lista, precio_clp) values ($1,'mostrador',$2)`,
        [productoId, precioMostradorClp]
      );
      if (precioMayoristaClp != null) {
        await tx.query(
          `insert into pan.precios (producto_id, lista, precio_clp) values ($1,'mayorista',$2)`,
          [productoId, precioMayoristaClp]
        );
      }
      return productoId;
    });
    return NextResponse.json({ id, nombre: nombre.trim(), tipoVenta });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/productos_nombre_key|unique/i.test(mensaje)) {
      return NextResponse.json({ error: "Ya existe un producto con ese nombre" }, { status: 409 });
    }
    console.error("POST /api/productos:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo crear el producto");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}

// Activar/desactivar, y/o cambiar precio. Un precio nunca se pisa (pan.precios está
// versionado por vigente_desde — 0002): "editar" el precio es insertar una fila
// nueva con la fecha de hoy, para que una venta de ayer siga leyendo el precio de
// ayer si alguna vez se audita. Dos ediciones el MISMO día sí se pisan entre sí
// (mismo vigente_desde = mismo día = misma fila) — corregir un error de tipeo recién
// cometido no debería dejar dos versiones del mismo día en el historial.
export async function PATCH(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { id?: string; activo?: boolean; precioMostradorClp?: number; precioMayoristaClp?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { id, activo, precioMostradorClp, precioMayoristaClp } = cuerpo;
  if (!id) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  if (activo === undefined && precioMostradorClp === undefined && precioMayoristaClp === undefined) {
    return NextResponse.json({ error: "Nada que cambiar" }, { status: 400 });
  }
  if (
    precioMostradorClp !== undefined &&
    (!Number.isInteger(precioMostradorClp) || precioMostradorClp <= 0)
  ) {
    return NextResponse.json({ error: "Precio de mostrador inválido" }, { status: 400 });
  }
  if (
    precioMayoristaClp !== undefined &&
    (!Number.isInteger(precioMayoristaClp) || precioMayoristaClp <= 0)
  ) {
    return NextResponse.json({ error: "Precio mayorista inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    if (activo !== undefined) {
      await db.query(`update pan.productos set activo = $1 where id = $2`, [activo, id]);
    }
    if (precioMostradorClp !== undefined) {
      await db.query(
        `insert into pan.precios (producto_id, lista, precio_clp) values ($1,'mostrador',$2)
           on conflict (producto_id, lista, vigente_desde) do update set precio_clp = excluded.precio_clp`,
        [id, precioMostradorClp]
      );
    }
    if (precioMayoristaClp !== undefined) {
      await db.query(
        `insert into pan.precios (producto_id, lista, precio_clp) values ($1,'mayorista',$2)
           on conflict (producto_id, lista, vigente_desde) do update set precio_clp = excluded.precio_clp`,
        [id, precioMayoristaClp]
      );
    }
    const r = await db.query<{ id: string; nombre: string; activo: boolean }>(
      `select id, nombre, activo from pan.productos where id = $1`,
      [id]
    );
    if (!r.rows[0]) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/productos:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo actualizar");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
