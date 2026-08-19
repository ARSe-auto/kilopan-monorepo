import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { retirarSobrePorClave } from "../../../servidor/aprobacion.ts";

// El aparato retira su sobre [AC-FIDN-02] — §5.4 F-C, §7.6.
//
// EL APARATO PREGUNTA, no le avisan. El §7.6 prohíbe que ningún paso dependa de push, así que
// la pantalla «Esperando aprobación» consulta acá cada pocos segundos. Es lo que hace que «la
// sesión arranca sola» sea cierto sin una notificación que puede no llegar —o llegar en tres
// minutos, con el operario mirando una pantalla que no cambia.
//
// PÚBLICO Y SIN SESIÓN, porque justamente lo que viene a buscar es la credencial con que va a
// tener sesión. Lo que devuelve es opaco: sin la privada NO EXTRAÍBLE del teléfono que lo
// solicitó, el sobre no sirve para nada. Y es de UN SOLO USO.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  let cuerpo: { clave_publica?: unknown };
  try {
    cuerpo = (await peticion.json()) as { clave_publica?: unknown };
  } catch {
    return Response.json({ error: "datos_incompletos" }, { status: 422 });
  }
  const clavePublica = typeof cuerpo.clave_publica === "string" ? cuerpo.clave_publica.trim() : "";
  if (!clavePublica) return Response.json({ error: "datos_incompletos" }, { status: 422 });

  const sobre = await retirarSobrePorClave(poolDe(bd), clavePublica);
  // 404 mientras no hay nada que retirar, y es la respuesta correcta para los TRES casos:
  // «todavía no te aprobaron», «ya lo retiraste» y «esa clave no es de acá». Distinguirlos le
  // diría a quien pregunta si la solicitud existe y en qué estado está.
  if (!sobre) return new Response(null, { status: 404 });
  return Response.json({ sobre });
}
