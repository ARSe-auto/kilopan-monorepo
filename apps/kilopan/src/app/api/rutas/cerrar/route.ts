import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirSesion } from "@/identidad/sesion.ts";
import { esUuid, aEnteroEnRango } from "@/comun/validacion.ts";

// AC-ADM-07 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): cerrar una ruta
// con odómetro desde /arreglar. SOLO admin —toda la superficie de /arreglar lo es (§5)—
// y el rechazo lo decide el SERVIDOR, no un enlace escondido (misma lección que
// pesaje_foto_obligatoria).
//
// Hoy "cerrar una ruta" no existe en ninguna pantalla (Anexo C, docs/PROMPT_CORRECTIVO.md
// §5: exige SQL a mano); PATCH /api/rutas ya sabe mover el estado a 'cerrada', pero
// ninguna pantalla lo invoca así y no exige motivo. Este endpoint es la vía real, con la
// regla transversal de la sección: toda acción destructiva se confirma ESCRIBIENDO el
// motivo —jamás marcando una casilla que se marca sin leer—, y deja su evento en
// pan.eventos con quién, cuándo y en qué equipo. `where estado <> 'cerrada'` hace
// idempotente el doble-tap: la segunda vez no encuentra fila que cerrar y rebota 409 en
// vez de pisar el odómetro ya registrado.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;
  if (sesion.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador cierra una ruta" }, { status: 403 });
  }

  let cuerpo: { rutaId?: string; kmInicio?: number; kmFin?: number; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!cuerpo.rutaId || !esUuid(cuerpo.rutaId)) {
    return NextResponse.json({ error: "Falta rutaId" }, { status: 400 });
  }
  // El odómetro alimenta el $/km del panel del dueño (db/migraciones/0005): un valor
  // negativo o no entero lo ensucia antes de que el CHECK rutas_km_fin_mayor de la BD
  // alcance a mirarlo.
  const kmFin = aEnteroEnRango(cuerpo.kmFin, 0);
  if (kmFin === null) {
    return NextResponse.json({ error: "Kilómetro final inválido" }, { status: 400 });
  }
  let kmInicio: number | null = null;
  if (cuerpo.kmInicio != null) {
    kmInicio = aEnteroEnRango(cuerpo.kmInicio, 0);
    if (kmInicio === null) {
      return NextResponse.json({ error: "Kilómetro de inicio inválido" }, { status: 400 });
    }
  }
  // El motivo se valida en el SERVIDOR: pedirlo solo en la pantalla es teatro de cliente
  // (misma lección que pesaje_foto_obligatoria). Sin CHECK que lo respalde en la BD
  // porque pan.rutas no gana columna nueva para esto — el motivo vive en el evento,
  // que ya es append-only.
  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ error: "Escribe el motivo del cierre" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    const resultado = await db.transaccion(async (tx) => {
      const previa = await tx.query<{ id: string; estado: string }>(
        `select id, estado from pan.rutas where id = $1 for update`,
        [cuerpo.rutaId]
      );
      const fila = previa.rows[0];
      if (!fila) return "no_existe" as const;
      if (fila.estado === "cerrada") return "ya_cerrada" as const;

      const upd = await tx.query<{ id: string }>(
        `update pan.rutas
            set estado = 'cerrada',
                km_inicio = coalesce($2, km_inicio),
                km_fin = $3
          where id = $1
          returning id`,
        [cuerpo.rutaId, kmInicio, kmFin]
      );
      const rutaId = upd.rows[0]!.id;
      // AC-ADM-10: mismo catálogo compartido que el resto de las operaciones de plata.
      await registrarEvento(tx, "ruta_cerrada", "rutas", rutaId, { motivo, kmInicio, kmFin }, sesion);
      return { id: rutaId };
    });

    if (resultado === "no_existe") {
      return NextResponse.json({ error: "La ruta no existe" }, { status: 404 });
    }
    if (resultado === "ya_cerrada") {
      return NextResponse.json({ error: "Esta ruta ya está cerrada" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: resultado.id });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/rutas_km_fin_mayor/i.test(mensaje)) {
      return NextResponse.json(
        { error: "El kilómetro final no puede ser menor que el de inicio" },
        { status: 400 }
      );
    }
    console.error("POST /api/rutas/cerrar:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo cerrar la ruta");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
