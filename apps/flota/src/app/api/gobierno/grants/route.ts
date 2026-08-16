import { headers } from "next/headers";
import { poolDe } from "../../../../servidor/conexion.ts";
import {
  otorgar,
  revocarDelTenant,
  listarGrants,
  ALCANCES,
  DURACIONES,
  type Alcance,
  type Duracion,
} from "../../../../servidor/soporte.ts";
import {
  guardia,
  tenantIdEnControl,
  enActo,
  registrarEvento,
  esUuid,
  EVENTOS,
} from "../../../../servidor/gobierno.ts";

// F-G del §5.4: el dueño otorga y revoca el acceso de soporte [AC-FIDN-12] — §4.3, §7.9.
//
// EL TENANT NUNCA LLEGA DE AFUERA. Sale del slug que `servidor.mjs` SOBRESCRIBE con el
// veredicto del ruteo, resuelto contra `control` (ver `tenantIdEnControl`), y el `where` del
// UPDATE lo lleva adentro: sin eso, el dueño de A revocaría el grant de B nombrando su uuid.
// Es el único endpoint del panel que toca `control`, y por eso el único donde el aislamiento
// del §4.1 no sale gratis de la separación física de las bases.
//
// LAS DOS BASES Y LA COSTURA, DECLARADA. El grant vive en `control` y su rastro visible para
// el dueño vive en el tenant (§4.3): son dos bases, así que no hay una transacción que las
// abarque. El orden es otorgar y después registrar, y si el registro falla el grant se REVOCA
// —compensación explícita— porque la alternativa es un acceso de la plataforma sin rastro en
// la auditoría del dueño, que es exactamente lo que el §7.9 existe para impedir. Un rastro de
// más se explica; uno de menos no se descubre.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTROL = "control";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const tenantId = await tenantIdEnControl(g.acto.slug);
  return Response.json({ grants: await listarGrants(poolDe(CONTROL), tenantId) });
}

export async function POST(peticion: Request) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }
  const accion = String(cuerpo.accion ?? "");
  const { pool, sesion } = g.acto;
  const control = poolDe(CONTROL);
  const tenantId = await tenantIdEnControl(g.acto.slug);

  if (accion === "revocar") {
    const grantId = String(cuerpo.grant_id ?? "");
    if (!esUuid(grantId)) {
      return Response.json({ error: "grant_desconocido" }, { status: 422 });
    }
    const hecho = await revocarDelTenant(control, tenantId, grantId);
    // Un grant de otro tenant se ve EXACTAMENTE igual que uno que no existe y que uno ya
    // revocado: cero filas tocadas y la misma respuesta. Distinguirlos le diría al dueño de A
    // que el uuid que probó es un grant real de alguien.
    if (!hecho) return Response.json({ estado: "sin_cambios" });
    await enActo(pool, (c) =>
      registrarEvento(c, {
        codigo: EVENTOS.soporte_revocado,
        objetoTabla: "grants_soporte",
        objetoId: grantId,
        sesion,
      }),
    );
    return Response.json({ estado: "revocado" });
  }

  if (accion !== "otorgar") {
    return Response.json(
      { error: "accion_desconocida", mensaje: "Acción no válida sobre el acceso de soporte." },
      { status: 422 },
    );
  }

  const alcance = String(cuerpo.alcance ?? "");
  const duracion = String(cuerpo.duracion ?? "");
  const otorgadoA = String(cuerpo.otorgado_a ?? "").trim();
  const motivo = String(cuerpo.motivo ?? "").trim();
  if (!ALCANCES.includes(alcance as Alcance) || !(duracion in DURACIONES)) {
    return Response.json(
      {
        error: "acceso_mal_definido",
        mensaje: "Elegí qué puede ver soporte y por cuánto tiempo.",
        alcances: ALCANCES,
        duraciones: Object.keys(DURACIONES),
      },
      { status: 422 },
    );
  }
  // El motivo es obligatorio en la BD (§4.3) y se rebota acá tipado en vez de dejar que salga
  // como error de restricción: un acceso a los datos de la empresa sin una razón escrita es
  // justamente el que después nadie puede explicar.
  if (!otorgadoA || !motivo) {
    return Response.json(
      { error: "falta_a_quien_o_por_que", mensaje: "Decí a quién le das acceso y para qué." },
      { status: 422 },
    );
  }

  const grant = await otorgar(control, {
    tenantId,
    otorgadoA,
    motivo,
    alcance: alcance as Alcance,
    duracion: duracion as Duracion,
  });

  try {
    await enActo(pool, (c) =>
      registrarEvento(c, {
        codigo: EVENTOS.soporte_otorgado,
        objetoTabla: "grants_soporte",
        objetoId: grant.id,
        sesion,
        payload: { alcance, duracion, otorgado_a: otorgadoA },
      }),
    );
  } catch (error) {
    await revocarDelTenant(control, tenantId, grant.id);
    throw error;
  }

  return Response.json(
    { id: grant.id, alcance: grant.alcance, expira_en: grant.expiraEn },
    { status: 201 },
  );
}
