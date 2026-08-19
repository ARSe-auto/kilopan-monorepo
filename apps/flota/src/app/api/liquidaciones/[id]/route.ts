import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import {
  liquidacionConLineas,
  puedeVerLiquidaciones,
  moduloDeLiquidacionEncendido,
} from "../../../../servidor/liquidaciones.ts";
import { moduloApagadoRespuesta } from "../../../../servidor/config.ts";

// La liquidación con sus líneas, para el drill-down del operador/admin [AC-FTAR-07] — spec 06
// §9. Sin sesión válida o id de otro tenant: 404 pelado, igual que el resto del panel — cada
// tenant es su propia base (§4.1), así que un id de B sencillamente no está en esta consulta.
// Sesión válida con un rol que el §8 mantiene sin dinero (`chofer`, `responsable_carga`) o que
// no es de este panel: 403 — es el mismo criterio de `guardia()` (gobierno.ts), aplicado acá
// porque esta puerta no es del dueño exclusivamente, es del operador Y del admin (§9 «Operador/
// admin (web, escritorio)»).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es de operación o administración." },
    { status: 403 },
  );

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (!puedeVerLiquidaciones(g.acto.sesion.rol)) return SIN_ACCESO();
  // La contracción por modo/entitlement [AC-FTAR-18]: en `mi_flota` —o con el feature apagado—
  // este módulo no existe para el tenant. Va DESPUÉS del rol y ANTES del id: el 403 del módulo
  // apagado se contesta igual para un id propio que para uno inventado, así que no filtra si la
  // liquidación existe; el 404 del id ajeno sigue siendo del camino de abajo.
  if (!(await moduloDeLiquidacionEncendido(g.acto.pool, g.acto.slug))) {
    return moduloApagadoRespuesta();
  }

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const liquidacion = await liquidacionConLineas(g.acto.pool, g.acto.sesion, id);
  if (!liquidacion) return noExiste();

  return Response.json({ liquidacion });
}
