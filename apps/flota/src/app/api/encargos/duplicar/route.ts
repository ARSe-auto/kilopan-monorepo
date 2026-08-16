import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { duplicarEncargos } from "../../../../servidor/encargos.ts";

// «Duplicar encargos de ayer» (F1) [AC-FRUT-17] — §5.2-F1, §3.E1.5, §9.3.1.
//
// Vía masiva SEPARADA de la importación CSV (§9.2: un AC por commit). La panadería que reparte a
// las mismas doce sucursales todos los días no tiene un Excel: tiene el día de ayer.
//
// Apretar el botón dos veces no duplica nada: el `client_uuid` se deriva del encargo original y
// de la fecha a la que se copia. Es el caso real —la pantalla tarda, alguien insiste— y sin esa
// derivación el segundo clic duplicaría el día entero.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const duplicacion = await duplicarEncargos(
    g.acto.pool,
    g.acto.sesion,
    cuerpo.origen ? String(cuerpo.origen) : null,
    cuerpo.destino ? String(cuerpo.destino) : null,
  );
  return Response.json(duplicacion);
}
