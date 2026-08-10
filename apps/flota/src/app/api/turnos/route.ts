import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../servidor/gobierno.ts";
import { abrirTurno, listarTurnos, ROLES_QUE_ABREN_TURNO } from "../../../servidor/turnos.ts";
import type { Rol } from "../../../../../../packages/nucleo-comun/src/constants.ts";

// Abrir el vehículo-día [AC-FVEH-06] — §4.5, §5.2-F3, §9.3 centinela 5.
//
// NO ESTÁ BAJO `/api/gobierno/**`, y es deliberado: abrir la jornada es un acto del TERRENO.
// El §5.5 lo dice con la app mínima —«abrir turno → paradas → cerrar turno»— y el §5.2-F3 lo
// pone en el teléfono del chofer. Ponerlo bajo el panel del dueño le devolvería 403 a quien
// tiene que hacerlo todos los días a las cinco de la mañana.
//
// El único rol que rebota es `cliente`: es la empresa CONTRATANTE (§4.3), que mira su portal;
// abrirle un turno le daría un vehículo-día que no es suyo y el denominador de la EEVD (§2)
// contaría una jornada que nadie trabajó.
//
// LA SUPERFICIE de la apertura —los ≤9 toques del F3, el chequeo pre, el odómetro y el
// semáforo— es de AC-FVEH-10. Acá está la puerta y su rebote: el segundo turno solapado del
// mismo vehículo sale 422 con 0 filas, decidido por el EXCLUDE de la base.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ turnos: await listarTurnos(g.acto.pool) });
}

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  if (!ROLES_QUE_ABREN_TURNO.includes(g.acto.sesion.rol as Rol)) {
    return Response.json(
      {
        error: "rol_sin_turno",
        mensaje: "Tu cuenta es de una empresa contratante: los turnos los abre quien opera la flota.",
      },
      { status: 403 },
    );
  }

  let cuerpo: { vehiculo_id?: unknown };
  try {
    cuerpo = (await peticion.json()) as { vehiculo_id?: unknown };
  } catch {
    cuerpo = {};
  }

  const vehiculoId = String(cuerpo.vehiculo_id ?? "");
  if (!esUuid(vehiculoId)) {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Elegí el vehículo con el que vas a trabajar hoy." },
      { status: 422 },
    );
  }

  const apertura = await abrirTurno(g.acto.pool, g.acto.sesion, g.acto.slug, vehiculoId);
  if (apertura.tipo === "vehiculo_no_existe") {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Ese vehículo no está en tu flota." },
      { status: 422 },
    );
  }
  if (apertura.tipo === "vehiculo_inactivo") {
    return Response.json(
      {
        error: "vehiculo_inactivo",
        mensaje: "Ese vehículo está desactivado. Pedile a quien administra que lo vuelva a activar.",
      },
      { status: 422 },
    );
  }
  if (apertura.tipo === "documento_vencido") {
    // §4.5 con el feature encendido. El mensaje nombra la causa: quien lo lee está por salir y
    // «no se pudo abrir» lo dejaría llamando a la oficina para averiguar qué pasó.
    return Response.json(
      {
        error: "documento_vencido",
        mensaje:
          "Ese vehículo tiene un documento vencido. Hay que renovarlo antes de abrir la jornada.",
      },
      { status: 422 },
    );
  }
  if (apertura.tipo === "turno_solapado") {
    // El centinela 5, con un mensaje que se puede actuar: quien lo lee está de pie al lado del
    // camión, y «restricción violada» no le dice qué hacer.
    return Response.json(
      {
        error: "turno_solapado",
        mensaje: "Ese vehículo ya tiene una jornada abierta. Hay que cerrarla antes de empezar otra.",
      },
      { status: 422 },
    );
  }
  return Response.json({ turno: apertura.turno }, { status: 201 });
}
