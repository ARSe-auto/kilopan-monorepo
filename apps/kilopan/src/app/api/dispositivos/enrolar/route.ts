import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { hashearPin, verificarPin } from "@/identidad/hash.ts";
import { permitirIntento } from "@/identidad/limitador.ts";
import { validaRut } from "@/comun/valida_rut.ts";

// Enrolar un equipo nuevo exige credenciales de un admin EN EL MOMENTO (no una sesión
// de dispositivo, porque este dispositivo todavía no tiene ninguna) — es la única
// ruta que verifica PIN sin pasar por /api/auth/login. Requiere rol='admin'.
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "desconocida";
  if (!permitirIntento(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Esperá un minuto." }, { status: 429 });
  }

  let cuerpo: { nombreDispositivo?: string; rutAdmin?: string; pinAdmin?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { nombreDispositivo, rutAdmin, pinAdmin } = cuerpo;
  if (!nombreDispositivo?.trim() || !rutAdmin || !pinAdmin) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (!validaRut(rutAdmin)) {
    return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  }

  const db = await obtenerDb();
  const admins = await db.query<{ id: string; rol: string; pin_hash: string }>(
    `select id, rol, pin_hash from pan.usuarios where rut = $1 and activo`,
    [rutAdmin]
  );
  const admin = admins.rows[0];
  if (!admin || admin.rol !== "admin" || !(await verificarPin(pinAdmin, admin.pin_hash))) {
    return NextResponse.json({ error: "Credenciales de administrador inválidas" }, { status: 401 });
  }

  const secreto = randomBytes(24).toString("base64url");
  const secretoHash = await hashearPin(secreto);
  const r = await db.query<{ id: string }>(
    `insert into pan.dispositivos (nombre, secreto_hash, enrolado_por) values ($1,$2,$3) returning id`,
    [nombreDispositivo.trim(), secretoHash, admin.id]
  );
  const dispositivoId = r.rows[0]?.id;
  if (!dispositivoId) {
    return NextResponse.json({ error: "No se pudo enrolar el equipo" }, { status: 500 });
  }

  // El secreto se devuelve UNA sola vez, acá — igual que un token de API. El cliente
  // lo guarda localmente (ver identidad/cliente/dispositivo.ts); el servidor solo
  // conserva el hash.
  return NextResponse.json({ dispositivoId, secreto, nombre: nombreDispositivo.trim() });
}
