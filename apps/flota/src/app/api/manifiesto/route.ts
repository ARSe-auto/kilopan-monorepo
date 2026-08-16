import { headers } from "next/headers";
import { sesionDelTenant, enActo } from "../../../servidor/gobierno.ts";
import { manifiestoDeNavegacion } from "../../../servidor/manifiesto.ts";

// El manifest de navegación del bootstrap [AC-FMIG-09] — §5.5, §0.
//
// Cualquier sesión del tenant, igual que `/api/vehiculos`: es lectura de lo que YA se puede
// ver, no una puerta del dueño. Sin sesión: 404, como el resto del ruteo.
//
// `enActo` y no `enLectura`: `versionVigente` sella la PRIMERA `config_version` del tenant si
// todavía no tiene ninguna (mismo camino que usa `abrirTurno`), y esa escritura no cabe en una
// transacción `read only`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const items = await enActo(
    g.acto.pool,
    (c) => manifiestoDeNavegacion(c, g.acto.slug),
    g.acto.sesion,
  );
  return Response.json({ items });
}
