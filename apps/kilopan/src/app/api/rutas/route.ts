import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion, exigirRol } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  // El repartidor ve SOLO su ruta; el admin ve todas.
  const r = await db.query<Record<string, unknown>>(
    `select r.id, r.fecha, r.estado, r.vehiculo, r.km_inicio, r.km_fin,
            u.nombre as repartidor,
            (select count(*)::int from pan.ruta_paradas rp where rp.ruta_id = r.id) as paradas,
            (select count(*)::int from pan.ruta_paradas rp
               where rp.ruta_id = r.id and not exists (
                 select 1 from pan.documento_tributario d
                  where d.pedido_id = rp.pedido_id and d.estado = 'registrado')) as paradas_sin_dte
       from pan.rutas r
       join pan.usuarios u on u.id = r.repartidor_id
      where r.fecha = current_date and ($1 = 'admin' or r.repartidor_id = $2)
      order by r.estado`,
    [sesion.rol, sesion.usuarioId]
  );
  return NextResponse.json({ rutas: r.rows });
}

export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador arma rutas" }, { status: 403 });
  }

  let cuerpo: { repartidorId?: string; vehiculo?: string; pedidoIds?: string[] };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { repartidorId, vehiculo, pedidoIds } = cuerpo;
  if (!repartidorId || !pedidoIds?.length) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  // Sin esto un id mal formado moría en el cast a uuid del `= any($1::uuid[])`.
  if (!esUuid(repartidorId) || !pedidoIds.every((id) => esUuid(id))) {
    return NextResponse.json({ error: "Repartidor o pedido inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    // La ruta y sus paradas entran juntas o ninguna: antes un corte a mitad del `for`
    // dejaba una ruta sin todas sus paradas, invisible para "Mi ruta" del repartidor.
    const rutaId = await db.transaccion(async (tx) => {
      // pan.pedidos nunca pasaba a 'en_ruta' al armar la ruta (el valor existe en el
      // CHECK desde 0004 pero nada lo usaba): un pedido "confirmado" lo seguía siendo
      // para siempre, así que dos clics del mismo botón —o dos rutas armadas más tarde
      // el mismo día para OTRO repartidor— podían meter el mismo pedido en dos rutas.
      // `for update` fija la fila mientras se decide para no correr esa carrera contra
      // un segundo POST casi simultáneo.
      const vigentes = await tx.query<{ id: string }>(
        `select id from pan.pedidos where id = any($1::uuid[]) and estado = 'confirmado' for update`,
        [pedidoIds]
      );
      const idsVigentes = new Set(vigentes.rows.map((p) => p.id));
      const aRutear = pedidoIds.filter((id) => idsVigentes.has(id));
      if (aRutear.length === 0) {
        throw Object.assign(new Error("pedidos_ya_ruteados"), {
          publico: "Esos pedidos ya están en otra ruta o ya no están confirmados",
        });
      }

      const ruta = await tx.query<{ id: string }>(
        `insert into pan.rutas (repartidor_id, vehiculo) values ($1,$2) returning id`,
        [repartidorId, vehiculo ?? null]
      );
      const id = ruta.rows[0]?.id;
      if (!id) throw new Error("No se pudo crear la ruta");

      // Orden a mano: el índice del array ES el orden de la ruta (sin VRP, por diseño).
      for (const [i, pedidoId] of aRutear.entries()) {
        await tx.query(`insert into pan.ruta_paradas (ruta_id, pedido_id, orden) values ($1,$2,$3)`, [
          id,
          pedidoId,
          i + 1,
        ]);
        await tx.query(`update pan.pedidos set estado = 'en_ruta' where id = $1`, [pedidoId]);
      }
      return { id, paradas: aRutear.length };
    });
    return NextResponse.json({ id: rutaId.id, paradas: rutaId.paradas });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/rutas_una_activa_por_repartidor_dia/i.test(mensaje)) {
      return NextResponse.json(
        { error: "Ese repartidor ya tiene una ruta abierta hoy — ciérrala antes de armar otra" },
        { status: 409 }
      );
    }
    const publico = err instanceof Error ? (err as Error & { publico?: string }).publico : undefined;
    if (publico) return NextResponse.json({ error: publico }, { status: 409 });
    console.error("POST /api/rutas:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo armar la ruta");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}

// AC-DES-02: «Salir a ruta». El trigger de la BD es el que manda — si falta un DTE,
// esto rebota y devuelve el motivo textual, sin override posible desde acá.
export async function PATCH(request: NextRequest) {
  // Hoy la única pantalla que llama a esto es /pedidos (armar+salir a ruta), admin-only.
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { rutaId?: string; estado?: string; kmInicio?: number; kmFin?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { rutaId, estado, kmInicio, kmFin } = cuerpo;
  if (!rutaId || !estado) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  // El $/km del panel del dueño sale de estos números — un odómetro negativo o no
  // entero los ensucia antes de que el trigger `km_fin >= km_inicio` alcance a mirarlos.
  if (kmInicio != null && (!Number.isInteger(kmInicio) || kmInicio < 0)) {
    return NextResponse.json({ error: "Kilómetro de inicio inválido" }, { status: 400 });
  }
  if (kmFin != null && (!Number.isInteger(kmFin) || kmFin < 0)) {
    return NextResponse.json({ error: "Kilómetro final inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    await db.query(
      `update pan.rutas
          set estado = $1,
              km_inicio = coalesce($2, km_inicio),
              km_fin = coalesce($3, km_fin)
        where id = $4`,
      [estado, kmInicio ?? null, kmFin ?? null, rutaId]
    );
    return NextResponse.json({ ok: true, estado });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/sin DTE asociado/i.test(mensaje)) {
      return NextResponse.json(
        { error: "No puedes salir: hay pedidos sin guía o factura asociada (art. 55 DL 825)" },
        { status: 409 }
      );
    }
    if (/rutas_km_fin_mayor/i.test(mensaje)) {
      return NextResponse.json(
        { error: "El kilómetro final no puede ser menor que el de inicio" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/rutas:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo actualizar la ruta");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
