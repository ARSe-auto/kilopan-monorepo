import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { cerrarTurnoPorLaFuerza, ROLES_QUE_CIERRAN_FORZADO } from "../../../../../servidor/turnos.ts";
import type { Rol } from "../../../../../../../../packages/nucleo-comun/src/constants.ts";

// Cierre forzado del turno que quedó abierto [AC-FVEH-22] — KR-41, §5.6, §4.5, §4.2.
//
// LA SALIDA DE UN ROJO QUE NO LA TENÍA. El semáforo detecta el turno sin cerrar (rojo del
// Anexo B) y hasta este AC no existía acción alguna que lo resolviera — un rojo sin salida,
// contra el contrato del §5.6 de que la cola tiende a cero cada día.
//
// ES PLANIFICACIÓN Y REBOTA. Lo hace alguien sentado con red mirando la bandeja, no una persona
// de pie al lado de un camión: rebotar acá no pierde ningún hecho del terreno, y dejar pasar un
// cierre sin motivo sí perdería la única explicación que ese turno va a tener en tres meses.
//
// LOS TRES DESENLACES DE ACCESO, iguales al resto de la app: sin sesión 404 pelado; con un rol
// que no es `operador` ni `admin_tenant`, 403 y cero filas; y un turno de OTRO tenant, 404 —
// que sale por construcción, porque cada tenant es su propia base (§4.1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  if (!ROLES_QUE_CIERRAN_FORZADO.includes(g.acto.sesion.rol as Rol)) {
    return Response.json(
      {
        error: "rol_sin_cierre_forzado",
        mensaje: "Cerrar un turno por la fuerza lo hace quien opera la flota o el dueño de la cuenta.",
      },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: { motivo?: unknown; nota?: unknown };
  try {
    cuerpo = (await peticion.json()) as { motivo?: unknown; nota?: unknown };
  } catch {
    cuerpo = {};
  }

  const cierre = await cerrarTurnoPorLaFuerza(g.acto.pool, g.acto.sesion, id, {
    motivoCodigo: String(cuerpo.motivo ?? ""),
    nota: cuerpo.nota ? String(cuerpo.nota) : null,
  });

  if (cierre.tipo === "no_existe") return noExiste();
  if (cierre.tipo === "sin_motivo") {
    return Response.json(
      {
        error: "sin_motivo",
        mensaje: "Un cierre por la fuerza necesita su motivo: sin él, en tres meses nadie va a saber qué pasó.",
      },
      { status: 422 },
    );
  }
  if (cierre.tipo === "motivo_desconocido") {
    // El motivo es TIPADO, del catálogo del tenant (§4.5). Un texto libre llenaría la bandeja
    // de explicaciones que no se pueden agrupar ni contar.
    return Response.json(
      {
        error: "motivo_desconocido",
        mensaje: "Ese motivo no está en el catálogo de tu cuenta.",
      },
      { status: 422 },
    );
  }
  if (cierre.tipo === "ya_no_esta_abierto") {
    return Response.json(
      {
        error: "ya_no_esta_abierto",
        mensaje: "Ese turno ya no está abierto. Alguien lo cerró antes que vos.",
      },
      { status: 422 },
    );
  }
  return Response.json({ turno_id: cierre.turnoId, estado: "cerrado_forzado" });
}
