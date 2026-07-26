import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { verificarPin } from "@/identidad/hash.ts";
import { permitirIntento, ipDelCliente } from "@/identidad/limitador.ts";
import { cabeceraCookieSesion } from "@/identidad/sesion.ts";
import { validaRut, formatearRut } from "@/comun/valida_rut.ts";
import { esUuid } from "@/comun/validacion.ts";

// F5 Cambio de operador (PROMPT_MAESTRO.md §5): RUT + PIN + dispositivo ya enrolado.
export async function POST(request: NextRequest) {
  const ip = ipDelCliente(request);
  if (!permitirIntento(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera un minuto." }, { status: 429 });
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
  // Superficie PRE-AUTENTICACIÓN: acá llega cualquiera, sin credenciales. Antes
  // reventaba con 500 ante entradas triviales — un `rut` numérico hacía que
  // validaRut(number) llamara .replace sobre un número (TypeError no capturado), y un
  // dispositivoId mal formado moría en el cast a uuid de `where id = $1`. Un 500 en
  // la puerta de entrada es ruido de monitoreo y fingerprinting del stack gratis.
  if (typeof rut !== "string" || typeof pin !== "string" || typeof dispositivoSecreto !== "string") {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!esUuid(dispositivoId)) {
    return NextResponse.json({ error: "Dispositivo no enrolado o revocado", codigo: "dispositivo_invalido" }, { status: 401 });
  }
  if (!validaRut(rut)) {
    return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  }
  // Hallazgo menor de la auditoría: pan.usuarios.rut se guarda con puntos y guión
  // (formatearRut), pero acá se comparaba el texto tal cual llegó — escribir el RUT
  // sin puntos daba "RUT o PIN incorrecto" y gastaba un intento del bloqueo de 15 min.
  const rutNormalizado = formatearRut(rut);

  const db = await obtenerDb();

  const dispositivos = await db.query<{ id: string; secreto_hash: string }>(
    `select id, secreto_hash from pan.dispositivos where id = $1 and revocado_at is null`,
    [dispositivoId]
  );
  const dispositivo = dispositivos.rows[0];
  // `codigo: "dispositivo_invalido"` en los dos rechazos a nivel de EQUIPO (no de
  // credenciales): antes esto llegaba a /ingresar como el mismo error de texto
  // plano que un RUT o PIN malo, y el operador no tenía ninguna salida — el equipo
  // sigue "vinculado" según su propio localStorage, pero el servidor ya no lo
  // reconoce (revocado, o el secreto no calza). Sin una señal que el cliente pueda
  // distinguir, no había forma de ofrecer "vincula este equipo de nuevo".
  if (!dispositivo) {
    return NextResponse.json(
      { error: "Dispositivo no enrolado o revocado", codigo: "dispositivo_invalido" },
      { status: 401 }
    );
  }
  const dispositivoOk = await verificarPin(dispositivoSecreto, dispositivo.secreto_hash);
  if (!dispositivoOk) {
    return NextResponse.json(
      { error: "Dispositivo no reconocido", codigo: "dispositivo_invalido" },
      { status: 401 }
    );
  }

  const usuarios = await db.query<{ id: string; nombre: string; rol: string; pin_hash: string }>(
    `select id, nombre, rol, pin_hash from pan.usuarios where rut = $1 and activo`,
    [rutNormalizado]
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
      { error: "Bloqueado por intentos fallidos. Espera 15 minutos." },
      { status: 423 }
    );
  }
  if (!pinCorrecto) {
    return NextResponse.json({ error: "RUT o PIN incorrecto" }, { status: 401 });
  }

  // AC-ID-06: pan.abrir_sesion() hace el relevo atómico — cierra la sesión que
  // hubiera abierta EN ESTE equipo (cambio de operador en tablet compartida, con
  // evento de auditoría) y abre la nueva. AC-ID-04 lo complementa: el trigger de
  // 0001 desplaza además las sesiones del mismo usuario en OTROS equipos.
  const sesion = await db.query<{ id: string }>(`select pan.abrir_sesion($1,$2) as id`, [
    dispositivoId,
    usuario.id,
  ]);
  const sesionId = sesion.rows[0]?.id;
  if (!sesionId) {
    return NextResponse.json({ error: "No se pudo crear la sesión" }, { status: 500 });
  }

  const respuesta = NextResponse.json({
    usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
  });
  respuesta.headers.set("Set-Cookie", cabeceraCookieSesion(sesionId, request));
  return respuesta;
}
