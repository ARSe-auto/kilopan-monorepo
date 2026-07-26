import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { roundClp } from "@/comun/round_clp.ts";
import { esUuid, normalizarUuid } from "@/comun/validacion.ts";

interface LineaEntrada {
  productoId: string;
  gramos: number;
  /** Lo que la pantalla le mostró al cliente. NO es el precio que se cobra: el que
   *  manda es el del catálogo en el servidor. Viaja solo para detectar divergencias. */
  precioClp?: number;
}

// F6 Venta mostrador (PROMPT_MAESTRO.md §5): contra el stock ya pesado.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "vendedor"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: {
    clientUuid?: string;
    medioPago?: string;
    lineas?: LineaEntrada[];
    clienteId?: string;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { clientUuid, medioPago, lineas, clienteId } = cuerpo;

  // Sin esto un reintento de la cola cobra dos veces (ver 0010_venta_idempotente.sql).
  if (!clientUuid || !/^[0-9a-f-]{36}$/i.test(clientUuid)) {
    return NextResponse.json({ error: "Falta client_uuid" }, { status: 400 });
  }
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

  // Idempotencia primero: si esta venta ya entró (reintento de la cola tras un corte
  // de señal), se devuelve la misma y no se cobra de nuevo.
  const yaExiste = await db.query<{ id: string; total_clp: number }>(
    `select id, total_clp from pan.ventas where client_uuid = $1`,
    [clientUuid]
  );
  if (yaExiste.rows[0]) {
    return NextResponse.json({ id: yaExiste.rows[0].id, totalClp: yaExiste.rows[0].total_clp });
  }

  const medio = await db.query<{ clave: string }>(`select clave from pan.medios_pago where clave = $1 and activo`, [
    medioPago,
  ]);
  if (medio.rows.length === 0) {
    return NextResponse.json({ error: "Medio de pago no disponible" }, { status: 400 });
  }

  // La lista la decide el cliente registrado (si lo hay); el mesón va a 'mostrador'.
  let lista = "mostrador";
  if (clienteId) {
    const c = await db.query<{ lista_precio: string }>(
      `select lista_precio from pan.clientes where id = $1 and activo`,
      [clienteId]
    );
    if (c.rows.length === 0) {
      return NextResponse.json({ error: "Ese cliente no existe o está inactivo" }, { status: 400 });
    }
    lista = c.rows[0]!.lista_precio;
  }

  // El PRECIO LO PONE EL SERVIDOR. Antes se guardaba el que mandaba el navegador: con
  // la consola abierta, cualquiera con sesión vendía 5 kg a $1 y la caja cuadraba
  // igual, porque el total también venía del cliente. El `precioClp` que llega ahora
  // solo sirve para detectar que la pantalla mostró otra cosa.
  // Acumular por producto ANTES de validar contra el stock: antes cada línea se
  // comparaba contra el stock COMPLETO por separado, así que dos líneas del mismo
  // producto (agregar 5 kg, después otros 5 kg) pasaban la validación una por una
  // aunque juntas superaran lo disponible — se vendía pan que no estaba en el mesón.
  //
  // La clave del Map va NORMALIZADA a minúsculas: Postgres trata `uuid` como
  // insensible a mayúsculas pero JS no, así que mandar la misma línea dos veces con
  // distinta capitalización ("a1b2…" y "A1B2…") las hacía ver como dos productos
  // distintos. Cada una pasaba la validación contra el stock COMPLETO por separado y
  // se vendía pan que no estaba en el mesón — exactamente el agujero que este
  // acumulador existe para tapar, reabierto por esa asimetría (red-team, ALTA).
  const gramosPorProducto = new Map<string, number>();
  for (const linea of lineas) {
    if (!esUuid(linea.productoId) || !Number.isInteger(linea.gramos) || linea.gramos < 1) {
      return NextResponse.json({ error: "Línea de venta inválida" }, { status: 400 });
    }
    const clave = normalizarUuid(linea.productoId);
    gramosPorProducto.set(clave, (gramosPorProducto.get(clave) ?? 0) + linea.gramos);
  }
  for (const [productoIdAcumulado, gramosAcumulados] of gramosPorProducto) {
    const stockAcumulado = await db.query<{ stock: number }>(`select pan.stock_disponible($1) as stock`, [
      productoIdAcumulado,
    ]);
    if ((stockAcumulado.rows[0]?.stock ?? 0) < gramosAcumulados) {
      return NextResponse.json(
        { error: `Stock insuficiente (disponible: ${stockAcumulado.rows[0]?.stock ?? 0} g)` },
        { status: 409 }
      );
    }
  }

  const calculadas: { productoId: string; gramos: number; precioClp: number }[] = [];
  for (const linea of lineas) {
    const precio = await db.query<{ precio: number | null }>(
      `select pan.precio_vigente($1,$2) as precio`,
      [linea.productoId, lista]
    );
    const precioKilo = precio.rows[0]?.precio;
    if (!precioKilo) {
      return NextResponse.json(
        { error: "Ese producto no tiene precio en la lista vigente" },
        { status: 409 }
      );
    }
    const precioLinea = roundClp((precioKilo * linea.gramos) / 1000);
    if (precioLinea < 1) {
      return NextResponse.json({ error: "El monto de la línea queda en cero" }, { status: 400 });
    }

    // Divergencia: la lista cambió entre que se armó el carro y se cobró. Se avisa en
    // vez de cobrar callado un número distinto al que vio el cliente parado al frente.
    if (linea.precioClp != null && linea.precioClp !== precioLinea) {
      return NextResponse.json(
        {
          error:
            "El precio cambió desde que armaste la venta. Revisa el total y vuelve a cobrar.",
        },
        { status: 409 }
      );
    }

    calculadas.push({ productoId: linea.productoId, gramos: linea.gramos, precioClp: precioLinea });
  }

  const totalClp = calculadas.reduce((suma, l) => suma + l.precioClp, 0);

  try {
    // UNA sola sentencia: la cabecera y las líneas entran juntas o no entra ninguna.
    // Antes eran N+1 queries sueltas y, contra una BD remota, un corte entre medio
    // dejaba una venta con total y sin líneas — plata en la caja sin respaldo de qué
    // se vendió. Un `begin` suelto no sirve acá: el pool puede mandar cada query por
    // una conexión distinta.
    const r = await db.query<{ id: string }>(
      `with nueva as (
         insert into pan.ventas
           (client_uuid, vendedor_id, dispositivo_id, medio_pago, total_clp, cliente_id)
         values ($1,$2,$3,$4,$5,$6)
         returning id
       ), ins as (
         insert into pan.venta_lineas (venta_id, producto_id, gramos, precio_clp)
         select nueva.id, x.producto_id, x.gramos, x.precio_clp
           from nueva, unnest($7::uuid[], $8::int[], $9::int[])
                       as x(producto_id, gramos, precio_clp)
         returning venta_id
       )
       select id from nueva`,
      [
        clientUuid,
        sesion.usuarioId,
        sesion.dispositivoId,
        medioPago,
        totalClp,
        clienteId ?? null,
        calculadas.map((l) => l.productoId),
        calculadas.map((l) => l.gramos),
        calculadas.map((l) => l.precioClp),
      ]
    );
    const ventaId = r.rows[0]?.id;
    if (!ventaId) throw new Error("No se pudo crear la venta");
    return NextResponse.json({ id: ventaId, totalClp });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/sin sesión/i.test(mensaje)) {
      return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
    }
    // Carrera: dos reintentos simultáneos de la misma venta. El unique la frena; se
    // devuelve la que quedó, que es exactamente lo que pide la idempotencia.
    if (/ventas_client_uuid_unico|duplicate key/i.test(mensaje)) {
      const existente = await db.query<{ id: string; total_clp: number }>(
        `select id, total_clp from pan.ventas where client_uuid = $1`,
        [clientUuid]
      );
      if (existente.rows[0]) {
        return NextResponse.json({ id: existente.rows[0].id, totalClp: existente.rows[0].total_clp });
      }
    }
    console.error("POST /api/ventas:", mensaje);
    return NextResponse.json({ error: "No se pudo registrar la venta" }, { status: 500 });
  }
}
