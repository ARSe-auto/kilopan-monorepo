import { headers } from "next/headers";
import {
  guardia,
  emitirInvitacion,
  listarInvitaciones,
  ROLES_INVITABLES,
  type RolInvitable,
} from "../../../../servidor/gobierno.ts";

// F-A del §5.4: emitir invitación, y el listado del panel [AC-FIDN-12].
//
// El código corto en claro sale UNA vez, acá, hacia el teléfono del dueño que lo emitió: de
// ahí se comparte con el share-sheet del sistema (Pregunta 5, respondida el 09-ago-2026). En
// la base queda solo su hash, así que este cuerpo es la única oportunidad de leerlo — y por
// eso el listado de más abajo no lo trae.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ invitaciones: await listarInvitaciones(g.acto.pool) });
}

export async function POST(peticion: Request) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: { rol?: unknown };
  try {
    cuerpo = (await peticion.json()) as { rol?: unknown };
  } catch {
    cuerpo = {};
  }

  const rol = String(cuerpo.rol ?? "");
  if (!ROLES_INVITABLES.includes(rol as RolInvitable)) {
    // 422 tipado y con la lista adentro: quien recibe esto es la PWA del dueño, y la
    // diferencia entre «rol inválido» y «ese rol no se invita desde acá» es la diferencia
    // entre creer que hay un error y saber dónde está la otra puerta (§4.2).
    return Response.json(
      {
        error: "rol_no_invitable",
        mensaje:
          "Ese rol no se invita desde este panel. El contratante se invita desde la ficha de " +
          "su empresa, y el dueño de la cuenta se transfiere con la ceremonia de propiedad.",
        invitables: ROLES_INVITABLES,
      },
      { status: 422 },
    );
  }

  const emitida = await emitirInvitacion(g.acto.pool, g.acto.sesion, rol as RolInvitable);
  return Response.json(
    { id: emitida.id, codigo: emitida.codigo, expira_at: emitida.expiraAt, rol },
    { status: 201 },
  );
}
