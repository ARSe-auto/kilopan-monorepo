import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { hashearPin, verificarPin } from "@/identidad/hash.ts";
import { permitirIntento, ipDelCliente } from "@/identidad/limitador.ts";
import { validaRut, formatearRut } from "@/comun/valida_rut.ts";

// Enrolar un equipo nuevo exige credenciales de un admin EN EL MOMENTO (no una sesión
// de dispositivo, porque este dispositivo todavía no tiene ninguna) — es la única
// ruta que verifica PIN sin pasar por /api/auth/login. Requiere rol='admin'.
export async function POST(request: NextRequest) {
  const ip = ipDelCliente(request);
  if (!permitirIntento(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera un minuto." }, { status: 429 });
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
    [formatearRut(rutAdmin)]
  );
  const admin = admins.rows[0];
  if (!admin || admin.rol !== "admin") {
    return NextResponse.json({ error: "Credenciales de administrador inválidas" }, { status: 401 });
  }

  // P0-1 (auditoría 1-ago-2026): la versión anterior creaba el dispositivo ANTES de
  // verificar el PIN, con un dispositivo_id NUEVO en cada intento. pan.registrar_intento_pin
  // bloquea por el PAR (dispositivo_id, usuario_id), así que con un dispositivo virgen
  // cada vez el contador de fallos siempre valía 1 y la rama 423 de abajo nunca se
  // alcanzaba — fuerza bruta de 10.000 PIN sin freno, desde internet, sin credenciales.
  //
  // El orden correcto: verificar el PIN PRIMERO, contra un candado que cuenta SOLO por
  // usuario_id (pan.registrar_intento_pin_enrolamiento, migración 0016 — no hay
  // dispositivo real todavía, así que no hay par que llavear). El dispositivo recién se
  // crea si el PIN es correcto y el usuario no está bloqueado. Nunca llega a
  // devolverse un secreto sin que el PIN haya sido correcto, igual que antes.
  const pinCorrecto = await verificarPin(pinAdmin, admin.pin_hash);
  const permitido = await db.query<{ permitido: boolean }>(
    `select pan.registrar_intento_pin_enrolamiento($1,$2) as permitido`,
    [admin.id, pinCorrecto]
  );
  if (!permitido.rows[0]?.permitido) {
    return NextResponse.json(
      { error: "Bloqueado por intentos fallidos. Espera 15 minutos." },
      { status: 423 }
    );
  }
  if (!pinCorrecto) {
    return NextResponse.json({ error: "Credenciales de administrador inválidas" }, { status: 401 });
  }

  const secreto = randomBytes(24).toString("base64url");
  const secretoHash = await hashearPin(secreto);
  const nuevoDispositivo = await db.query<{ id: string }>(
    `insert into pan.dispositivos (nombre, secreto_hash, enrolado_por) values ($1,$2,$3) returning id`,
    [nombreDispositivo.trim(), secretoHash, admin.id]
  );
  const dispositivoId = nuevoDispositivo.rows[0]?.id;
  if (!dispositivoId) {
    return NextResponse.json({ error: "No se pudo enrolar el equipo" }, { status: 500 });
  }

  // El secreto se devuelve UNA sola vez, acá — igual que un token de API. El cliente
  // lo guarda localmente (ver identidad/cliente/dispositivo.ts); el servidor solo
  // conserva el hash.
  return NextResponse.json({ dispositivoId, secreto, nombre: nombreDispositivo.trim() });
}
