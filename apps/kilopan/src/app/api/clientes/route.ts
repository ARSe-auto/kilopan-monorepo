import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion, exigirRol } from "@/identidad/sesion.ts";
import { validaRut } from "@/comun/valida_rut.ts";

// El saldo de fiado que devuelve esta lectura es plata: solo quien puede fiar
// (vendedor en el mesón) o administrar clientes lo necesita.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "vendedor"]);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const r = await db.query<Record<string, unknown>>(
    `select c.id, c.rut, c.razon_social, c.canal, c.direccion, c.contacto_nombre, c.lista_precio,
            s.saldo_pendiente_clp
       from pan.clientes c
       left join pan.saldo_cliente s on s.cliente_id = c.id
      where c.activo order by c.razon_social`
  );
  return NextResponse.json({ clientes: r.rows });
}

export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador da de alta clientes" }, { status: 403 });
  }

  let cuerpo: Record<string, string | undefined>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { rut, razonSocial, canal, direccion, contactoNombre, contactoFono } = cuerpo;
  if (!rut || !razonSocial || !canal) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (!validaRut(rut)) return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  if (canal !== "mostrador" && canal !== "reparto") {
    return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const r = await db.query<{ id: string }>(
      `insert into pan.clientes (rut, razon_social, canal, direccion, contacto_nombre, contacto_fono)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [rut, razonSocial, canal, direccion ?? null, contactoNombre ?? null, contactoFono ?? null]
    );
    return NextResponse.json({ id: r.rows[0]?.id });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(mensaje)) {
      return NextResponse.json({ error: "Ya existe un cliente con ese RUT" }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo crear el cliente" }, { status: 500 });
  }
}
