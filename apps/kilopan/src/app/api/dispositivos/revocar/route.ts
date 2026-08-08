import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-ADM-08 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): revocar un equipo
// enrolado desde /arreglar. SOLO admin —toda la superficie de /arreglar lo es (§5)— y el
// rechazo lo decide el SERVIDOR, no un enlace escondido (misma lección que
// pesaje_foto_obligatoria). Anexo C de docs/PROMPT_CORRECTIVO.md: hoy "revocar un equipo
// perdido" exige SQL a mano.
//
// `pan.dispositivos.revocado_at` ya existía (0001) y ya lo respeta el login (`where
// revocado_at is null`), pero nada lo escribía desde la app. Revocar no solo cierra la
// puerta a un login futuro: si el equipo tenía una sesión de operador VIVA en este
// instante (el caso real de un equipo perdido, no uno guardado en un cajón), esa sesión
// se cierra en la misma transacción — de lo contrario "revocar" es teatro mientras quien
// tenga el equipo en la mano sigue operando hasta que expire por su cuenta (10 min de
// inactividad o 12 h de tope duro).
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador revoca un equipo" }, { status: 403 });
  }

  let cuerpo: { dispositivoId?: string; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!cuerpo.dispositivoId || !esUuid(cuerpo.dispositivoId)) {
    return NextResponse.json({ error: "Falta dispositivoId" }, { status: 400 });
  }
  // El motivo se valida en el SERVIDOR: pedirlo solo en la pantalla es teatro de cliente
  // (misma lección que pesaje_foto_obligatoria).
  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ error: "Escribe el motivo de la revocación" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const resultado = await db.transaccion(async (tx) => {
      const previo = await tx.query<{ id: string; revocado_at: string | null }>(
        `select id, revocado_at from pan.dispositivos where id = $1 for update`,
        [cuerpo.dispositivoId]
      );
      const fila = previo.rows[0];
      if (!fila) return "no_existe" as const;
      if (fila.revocado_at !== null) return "ya_revocado" as const;

      const upd = await tx.query<{ id: string }>(
        `update pan.dispositivos set revocado_at = now() where id = $1 returning id`,
        [cuerpo.dispositivoId]
      );
      const dispositivoId = upd.rows[0]!.id;
      // Cierra cualquier sesión de operador viva en el equipo revocado — ver nota arriba.
      await tx.query(
        `update pan.sesiones_operador set fin = now() where dispositivo_id = $1 and fin is null`,
        [dispositivoId]
      );
      // AC-ADM-10: `equipo_revocado` ya vivía declarado en el catálogo sin ruta.
      await registrarEvento(tx, "equipo_revocado", "dispositivos", dispositivoId, { motivo }, sesion);
      return { id: dispositivoId };
    });

    if (resultado === "no_existe") {
      return NextResponse.json({ error: "El equipo no existe" }, { status: 404 });
    }
    if (resultado === "ya_revocado") {
      return NextResponse.json({ error: "Este equipo ya estaba revocado" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    console.error("POST /api/dispositivos/revocar:", err instanceof Error ? err.message : String(err));
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo revocar el equipo");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
