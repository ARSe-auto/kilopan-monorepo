import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { notaDelTurnoAnterior } from "../../../../servidor/turnos.ts";
import { terminologiaDeTurno } from "../../../../servidor/terminologia.ts";

// El turno abierto de este tenant, con la nota que le dejó el anterior [AC-FVEH-21, AC-FVEH-10]
// y su terminología CONGELADA [AC-FMIG-06].
//
// Es lo que «Tu turno de hoy» (§5.2-F3) necesita saber al abrir la pantalla: si hay una jornada
// en curso, qué le dejó dicho quien manejó antes ese mismo vehículo, y con qué diccionario —el
// de SU `config_version_id`, no el que el panel admin tenga hoy— tiene que hablarle (§4.4). Es
// la puerta que una pantalla de terreno ligada al turno abierto usaría para no cambiar términos
// a mitad de turno; `terminologiaDeTurno` es la que hace la diferencia con `GET
// /api/terminologia`, que sirve siempre en vivo.
//
// `nota: null` cuando no hay, y la pantalla NO muestra un recuadro vacío: un lugar que casi
// siempre está en blanco enseña a no mirarlo, y el día que traiga algo importante nadie lo lee.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { rows } = await g.acto.pool.query<{ id: string; vehiculo_id: string; patente: string }>(
    `select t.id::text as id, t.vehiculo_id::text as vehiculo_id, v.patente
       from turnos t join vehiculos v on v.id = t.vehiculo_id
      where t.estado = 'abierto'
      order by t.abierto_en desc limit 1`,
  );
  const turno = rows[0] ?? null;
  return Response.json({
    turno,
    nota: turno ? await notaDelTurnoAnterior(g.acto.pool, turno.vehiculo_id) : null,
    terminos: turno ? await terminologiaDeTurno(g.acto.pool, turno.id) : null,
  });
}
