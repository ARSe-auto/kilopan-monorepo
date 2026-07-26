import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { hashearPin } from "@/identidad/hash.ts";
import { validaRut, formatearRut } from "@/comun/valida_rut.ts";

const ROLES = ["admin", "maestro", "vendedor", "repartidor"];
const PIN_VALIDO = /^\d{4}$/;

// Solo id/nombre/rol: ni el RUT ni nada de identidad viaja de más. El pin_hash
// obviamente jamás sale de la BD. Aun así es la nómina completa del personal —
// solo /pedidos la consulta (para armar rutas) y esa pantalla es admin-only.
//
// `?detalle=1` es para /admin (gestión de personal): ahí el RUT SÍ hace falta para
// identificar a quién se está editando, y también hay que poder ver — y reactivar —
// a alguien inactivo, no solo a los activos que ve el selector de /pedidos.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  const rol = request.nextUrl.searchParams.get("rol");
  if (rol && !ROLES.includes(rol)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }
  const detalle = request.nextUrl.searchParams.get("detalle") === "1";

  const db = await obtenerDb();
  if (detalle) {
    const r = await db.query<{ id: string; nombre: string; rut: string; rol: string; activo: boolean }>(
      `select id, nombre, rut, rol, activo from pan.usuarios
        where ($1::text is null or rol = $1) order by activo desc, nombre`,
      [rol]
    );
    return NextResponse.json({ usuarios: r.rows });
  }

  const r = await db.query<{ id: string; nombre: string; rol: string }>(
    `select id, nombre, rol from pan.usuarios
      where activo and ($1::text is null or rol = $1) order by nombre`,
    [rol]
  );
  return NextResponse.json({ usuarios: r.rows });
}

// AC-ADM-01: dar de alta personal desde la propia app — antes solo existía por SQL
// directo (nadie lo haría en una panadería real; era un bloqueador de producto, no
// un defecto puntual).
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { nombre?: string; rut?: string; rol?: string; pin?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { nombre, rut, rol, pin } = cuerpo;
  if (!nombre?.trim() || !rut || !rol || !pin) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (!validaRut(rut)) {
    return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  }
  if (!ROLES.includes(rol)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }
  if (!PIN_VALIDO.test(pin)) {
    return NextResponse.json({ error: "El PIN debe ser de 4 dígitos" }, { status: 400 });
  }

  const db = await obtenerDb();
  const rutNormalizado = formatearRut(rut);
  const pinHash = await hashearPin(pin);
  try {
    const r = await db.query<{ id: string }>(
      `insert into pan.usuarios (nombre, rut, rol, pin_hash) values ($1,$2,$3,$4) returning id`,
      [nombre.trim(), rutNormalizado, rol, pinHash]
    );
    return NextResponse.json({ id: r.rows[0]?.id, nombre: nombre.trim(), rut: rutNormalizado, rol });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/usuarios_rut_key|unique/i.test(mensaje)) {
      return NextResponse.json({ error: "Ya existe una persona con ese RUT" }, { status: 409 });
    }
    console.error("POST /api/usuarios:", mensaje);
    return NextResponse.json({ error: "No se pudo crear la persona" }, { status: 500 });
  }
}

// Activar/desactivar (nunca se borra — es nómina, y pesajes/ventas/entregas ya
// pasadas referencian a esta fila por FK), cambiar de rol, o resetear el PIN
// (el dueño de una panadería es quien atiende "se me olvidó el PIN", no un admin de
// sistema). Todo en un solo PATCH porque son tres botones de la misma fila en /admin,
// nunca los tres a la vez.
export async function PATCH(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { id?: string; activo?: boolean; rol?: string; pin?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { id, activo, rol, pin } = cuerpo;
  if (!id) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  if (activo === undefined && rol === undefined && pin === undefined) {
    return NextResponse.json({ error: "Nada que cambiar" }, { status: 400 });
  }
  if (rol !== undefined && !ROLES.includes(rol)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }
  if (pin !== undefined && !PIN_VALIDO.test(pin)) {
    return NextResponse.json({ error: "El PIN debe ser de 4 dígitos" }, { status: 400 });
  }
  // Un admin no puede desactivarse ni quitarse el rol de admin a sí mismo: la
  // panadería se queda sin nadie que pueda revertirlo — el mismo candado que ya
  // tenía api/rutas para no poder pisar tu propia sesión.
  if (id === sesion.usuarioId && (activo === false || (rol !== undefined && rol !== "admin"))) {
    return NextResponse.json(
      { error: "No puedes quitarte tu propio acceso de administrador" },
      { status: 400 }
    );
  }

  const db = await obtenerDb();
  try {
    if (activo !== undefined) {
      await db.query(`update pan.usuarios set activo = $1 where id = $2`, [activo, id]);
    }
    if (rol !== undefined) {
      await db.query(`update pan.usuarios set rol = $1 where id = $2`, [rol, id]);
    }
    if (pin !== undefined) {
      const pinHash = await hashearPin(pin);
      await db.query(`update pan.usuarios set pin_hash = $1 where id = $2`, [pinHash, id]);
    }
    const r = await db.query<{ id: string; nombre: string; rut: string; rol: string; activo: boolean }>(
      `select id, nombre, rut, rol, activo from pan.usuarios where id = $1`,
      [id]
    );
    if (!r.rows[0]) return NextResponse.json({ error: "Persona no encontrada" }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/usuarios:", mensaje);
    return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  }
}
