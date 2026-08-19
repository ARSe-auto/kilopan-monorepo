import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { capturarPosicion } from "../../../../../servidor/posiciones.ts";
import { ROLES_QUE_ABREN_TURNO } from "../../../../../servidor/turnos.ts";
import type { Rol } from "../../../../../../../../packages/nucleo-comun/src/constants.ts";

// La captura de UN punto de posición en vivo, por HTTP [AC-FTEL-01] — §7.8, §11.
//
// El turno viaja como SEGMENTO, igual que el resto de las mutaciones sobre un turno
// (`/api/turnos/[id]/cierre`). La privacidad de verdad —que un turno cerrado rebote, sin
// excepción— la decide la BASE (0074): acá solo se traduce su rebote a un 422 tipado. El lote
// batcheado con reintento offline (el motor de sync existente) es AC-FTEL-03; este endpoint es
// la puerta mínima con la que el chofer del terreno prueba HOY que cerrar el turno apaga el
// rastreo, no la superficie final.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  // `cliente` es la empresa CONTRATANTE (§4.3): no está en el terreno y no tiene posición que
  // capturar. Mismo conjunto de roles que abre la jornada.
  if (!ROLES_QUE_ABREN_TURNO.includes(g.acto.sesion.rol as Rol)) {
    return Response.json(
      { error: "rol_sin_rastreo", mensaje: "Tu cuenta no captura posición en ruta." },
      { status: 403 },
    );
  }

  let cuerpo: { lat?: unknown; lng?: unknown };
  try {
    cuerpo = (await peticion.json()) as { lat?: unknown; lng?: unknown };
  } catch {
    cuerpo = {};
  }
  const lat = Number(cuerpo.lat);
  const lng = Number(cuerpo.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { error: "posicion_mal_formada", mensaje: "Falta `lat`/`lng`, o no son números." },
      { status: 422 },
    );
  }

  const resultado = await capturarPosicion(g.acto.pool, g.acto.sesion, { turnoId: id, lat, lng });
  if (resultado.tipo === "turno_no_abierto") {
    return Response.json(
      {
        error: "turno_no_abierto",
        mensaje:
          "Ese turno no está abierto: la privacidad del rastreo exige turno abierto para capturar (§7.8).",
      },
      { status: 422 },
    );
  }
  return Response.json({ id: resultado.id }, { status: 201 });
}
