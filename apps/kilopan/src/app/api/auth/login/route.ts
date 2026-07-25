import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { verificarPin } from "@/identidad/hash.ts";
import { permitirIntento } from "@/identidad/limitador.ts";
import { NOMBRE_COOKIE, OPCIONES_COOKIE } from "@/identidad/sesion.ts";
import { validaRut } from "@/comun/valida_rut.ts";

// F5 Cambio de operador (PROMPT_MAESTRO.md §5): RUT + PIN + dispositivo ya enrolado.
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "desconocida";
  if (!permitirIntento(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Esperá un minuto." }, { status: 429 });
  }

  let cuerpo: { rut?: string; pin?: string; dispositivoId?: string; dispositivoSecreto?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { rut, pin, dispositivoId, dispositivoSecreto } = cuerpo;
  if (!rut || !pin || !dispositivoId || !dispositivoSecreto) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (!validaRut(rut)) {
    return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  }

  const db = await obtenerDb();

  const dispositivos = await db.query<{ id: string; secreto_hash: string }>(
    `select id, secreto_hash from pan.dispositivos where id = $1 and revocado_at is null`,
    [dispositivoId]
  );
  const dispositivo = dispositivos.rows[0];
  if (!dispositivo) {
    return NextResponse.json({ error: "Dispositivo no enrolado o revocado" }, { status: 401 });
  }
  const dispositivoOk = await verificarPin(dispositivoSecreto, dispositivo.secreto_hash);
  if (!dispositivoOk) {
    return NextResponse.json({ error: "Dispositivo no reconocido" }, { status: 401 });
  }

  const usuarios = await db.query<{ id: string; nombre: string; rol: string; pin_hash: string }>(
    `select id, nombre, rol, pin_hash from pan.usuarios where rut = $1 and activo`,
    [rut]
  );
  const usuario = usuarios.rows[0];
  if (!usuario) {
    return NextResponse.json({ error: "RUT o PIN incorrecto" }, { status: 401 });
  }

  const pinCorrecto = await verificarPin(pin, usuario.pin_hash);

  // AC-SEC-01: registra el intento SIEMPRE, gane o pierda — es lo que arma el bloqueo.
  const permitido = await db.query<{ permitido: boolean }>(
    `select pan.registrar_intento_pin($1,$2,$3) as permitido`,
    [dispositivoId, usuario.id, pinCorrecto]
  );
  if (!permitido.rows[0]?.permitido) {
    return NextResponse.json(
      { error: "Bloqueado por intentos fallidos. Esperá 15 minutos." },
      { status: 423 }
    );
  }
  if (!pinCorrecto) {
    return NextResponse.json({ error: "RUT o PIN incorrecto" }, { status: 401 });
  }

  // AC-ID-04: el trigger desplaza cualquier sesión previa del mismo usuario en otro
  // dispositivo, con su evento de auditoría — no hace falta lógica extra acá.
  const sesion = await db.query<{ id: string }>(
    `insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2) returning id`,
    [dispositivoId, usuario.id]
  );
  const sesionId = sesion.rows[0]?.id;
  if (!sesionId) {
    return NextResponse.json({ error: "No se pudo crear la sesión" }, { status: 500 });
  }

  const respuesta = NextResponse.json({
    usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
  });
  respuesta.cookies.set(NOMBRE_COOKIE, sesionId, OPCIONES_COOKIE);
  return respuesta;
}
