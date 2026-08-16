import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../servidor/gobierno.ts";
import { notaDelTurnoAnterior } from "../../../../servidor/turnos.ts";

// La nota que el turno ANTERIOR de este vehículo dejó para el siguiente [AC-FVEH-21].
//
// El §5.2-F5 la captura en el cierre y el §5.2-F3 la muestra en la apertura. Esa cadena es todo
// el valor de la nota: sin ella, escribir «el freno de mano patina» sería escribirle a nadie.
//
// Sale del campo `nota` del chequeo POST, que es donde la spec la pone, y del ÚLTIMO que la
// tenga — no del último chequeo a secas: si el turno de ayer no dejó nota, la de anteayer sigue
// siendo la última cosa que alguien quiso decir sobre ese vehículo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const vehiculoId = new URL(peticion.url).searchParams.get("vehiculo_id") ?? "";
  if (!esUuid(vehiculoId)) return noExiste();
  return Response.json({ nota: await notaDelTurnoAnterior(g.acto.pool, vehiculoId) });
}
