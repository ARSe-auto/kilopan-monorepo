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

  // AC-SEC-01 (Tanda 6 de la auditoría): esta era la única verificación de PIN del
  // sistema que no pasaba por pan.registrar_intento_pin, así que el bloqueo de 15 min
  // nunca se disparaba acá — un PIN de 4 dígitos son solo 10.000 combinaciones. La
  // función exige un dispositivo_id REAL (FK not null), y este endpoint todavía no
  // tiene uno hasta que el PIN es correcto — problema de orden, no de diseño: se crea
  // el dispositivo ANTES de verificar el PIN, con su secreto ya hasheado, y si el PIN
  // falla o el bloqueo ya está activo se revoca al toque. Nunca llega a devolverse un
  // secreto sin que el PIN haya sido correcto.
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

  const pinCorrecto = await verificarPin(pinAdmin, admin.pin_hash);
  const permitido = await db.query<{ permitido: boolean }>(
    `select pan.registrar_intento_pin($1,$2,$3) as permitido`,
    [dispositivoId, admin.id, pinCorrecto]
  );
  if (!permitido.rows[0]?.permitido) {
    await db.query(`update pan.dispositivos set revocado_at = now() where id = $1`, [dispositivoId]);
    return NextResponse.json(
      { error: "Bloqueado por intentos fallidos. Espera 15 minutos." },
      { status: 423 }
    );
  }
  if (!pinCorrecto) {
    await db.query(`update pan.dispositivos set revocado_at = now() where id = $1`, [dispositivoId]);
    return NextResponse.json({ error: "Credenciales de administrador inválidas" }, { status: 401 });
  }

  // El secreto se devuelve UNA sola vez, acá — igual que un token de API. El cliente
  // lo guarda localmente (ver identidad/cliente/dispositivo.ts); el servidor solo
  // conserva el hash.
  return NextResponse.json({ dispositivoId, secreto, nombre: nombreDispositivo.trim() });
}
