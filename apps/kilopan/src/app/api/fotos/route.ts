import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

const MAX_BYTES = 1_500_000; // techo duro; el cliente comprime a ~400 KB (AC-PERF-02)

// AC-SEC-07: subida de evidencia. El servidor RECALCULA el sha256 — nunca confía en
// el que manda el cliente: si no cuadra con el declarado en el POD, la foto no entra.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const form = await request.formData().catch(() => null);
  const archivo = form?.get("foto");
  if (!(archivo instanceof Blob)) {
    return NextResponse.json({ error: "Falta la foto" }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "La foto es demasiado pesada" }, { status: 413 });
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const declarado = form?.get("sha256");
  if (typeof declarado === "string" && declarado && declarado !== sha256) {
    return NextResponse.json(
      { error: "El hash no coincide con el archivo: la foto no corresponde a esta entrega" },
      { status: 409 }
    );
  }

  const db = await obtenerDb();
  // Misma foto subida dos veces (reintento de red) = una sola fila, sin error.
  await db.query(
    `insert into pan.fotos (sha256, contenido, mime, bytes, subida_por)
     values ($1,$2,$3,$4,$5) on conflict (sha256) do nothing`,
    [sha256, buffer, archivo.type || "image/jpeg", buffer.length, sesion.usuarioId]
  );

  // Confirmar la evidencia en la entrega: es el ÚNICO UPDATE que el trigger de POD
  // inmutable deja pasar sobre una entrega cerrada.
  await db.query(
    `update pan.entregas set foto_estado = 'subida'
      where foto_sha256 = $1 and foto_estado = 'pendiente_subida'`,
    [sha256]
  );

  // Lo mismo para el pesaje (AC-PES-04). El endpoint es uno solo a propósito: la foto
  // es evidencia y se guarda igual venga de donde venga; lo único que cambia es qué
  // fila queda marcada como respaldada.
  await db.query(
    `update pan.pesajes set foto_estado = 'subida'
      where foto_sha256 = $1 and foto_estado = 'pendiente_subida'`,
    [sha256]
  );

  return NextResponse.json({ sha256, bytes: buffer.length });
}

// Servir la evidencia. Solo con sesión viva — una foto de POD no es pública.
export async function GET(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  const sha256 = request.nextUrl.searchParams.get("sha256");
  if (!sha256) return NextResponse.json({ error: "Falta sha256" }, { status: 400 });

  const db = await obtenerDb();
  const r = await db.query<{ contenido: Uint8Array; mime: string }>(
    `select contenido, mime from pan.fotos where sha256 = $1`,
    [sha256]
  );
  const foto = r.rows[0];
  if (!foto) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  return new NextResponse(Buffer.from(foto.contenido), {
    headers: { "Content-Type": foto.mime, "Cache-Control": "private, max-age=3600" },
  });
}
