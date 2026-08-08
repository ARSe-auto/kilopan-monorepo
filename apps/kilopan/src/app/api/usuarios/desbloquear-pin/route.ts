import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-ADM-08 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): desbloquear un PIN
// desde /arreglar. SOLO admin —toda la superficie de /arreglar lo es (§5)— y el rechazo lo
// decide el SERVIDOR. Anexo C de docs/PROMPT_CORRECTIVO.md: hoy "desbloquear un PIN antes
// de los 15 minutos" exige SQL a mano.
//
// El bloqueo de AC-SEC-01 (`pan.registrar_intento_pin`, 0001) llavea `pan.bloqueos_pin`
// por (dispositivo_id, usuario_id): a los 5 intentos fallidos en 10 min ese PAR queda
// bloqueado 15 minutos. Desde /arreglar el admin no necesariamente sabe en qué equipo
// falló la persona —solo que quedó bloqueada—, así que este endpoint borra TODOS los
// bloqueos vigentes de esa persona, en cualquier equipo, no uno solo: dejar un bloqueo
// vivo en otro dispositivo sería un "desbloqueo" a medias.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador desbloquea un PIN" }, { status: 403 });
  }

  let cuerpo: { usuarioId?: string; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { usuarioId } = cuerpo;
  if (!usuarioId || !esUuid(usuarioId)) {
    return NextResponse.json({ error: "Falta usuarioId" }, { status: 400 });
  }
  // El motivo se valida en el SERVIDOR: pedirlo solo en la pantalla es teatro de cliente
  // (misma lección que pesaje_foto_obligatoria).
  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ error: "Escribe el motivo del desbloqueo" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const resultado = await db.transaccion(async (tx) => {
      const existe = await tx.query<{ id: string }>(`select id from pan.usuarios where id = $1`, [usuarioId]);
      if (!existe.rows[0]) return "no_existe" as const;

      const borrados = await tx.query<{ dispositivo_id: string }>(
        `delete from pan.bloqueos_pin where usuario_id = $1 and bloqueado_hasta > now() returning dispositivo_id`,
        [usuarioId]
      );
      if (borrados.rows.length === 0) return "no_bloqueado" as const;

      await registrarEvento(
        tx,
        "pin_desbloqueado",
        "usuarios",
        usuarioId,
        { motivo, equipos: borrados.rows.length },
        sesion
      );
      return { id: usuarioId };
    });

    if (resultado === "no_existe") {
      return NextResponse.json({ error: "La persona no existe" }, { status: 404 });
    }
    if (resultado === "no_bloqueado") {
      return NextResponse.json({ error: "Esta persona no tiene el PIN bloqueado" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    console.error("POST /api/usuarios/desbloquear-pin:", err instanceof Error ? err.message : String(err));
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo desbloquear el PIN");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
