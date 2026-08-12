import { headers } from "next/headers";
import { guardia, enActo, inventarioDeDispositivos } from "../../../../servidor/gobierno.ts";
import { enrolarAnden } from "../../../../servidor/anden.ts";

// Inventario VIVO de dispositivos [AC-FIDN-12] — §5.4.
//
// Trae los revocados junto a los activos, y primero los activos. Un inventario que escondiera
// los revocados dejaría al dueño sin la única pantalla donde se ve que el teléfono que se
// perdió el martes efectivamente está fuera — que es la pregunta que se hace cuando alguien
// llama diciendo que perdió el teléfono.
//
// `is_standalone` y `storage_persisted` van porque son la condición de enrolamiento completo
// del §4.3 (AC-FIDN-05): un aparato sin las dos captura sin red pero puede perder el outbox,
// y eso el dueño tiene que poder verlo antes de que se pierda un POD.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ dispositivos: await inventarioDeDispositivos(g.acto.pool) });
}

// Enrolar el dispositivo de ANDÉN [AC-FIDN-07] — §4.3, §5.4 F-D.
//
// Es del dueño y de nadie más: el aparato compartido queda enrolado como activo del tenant, sin
// persona dueña, y por él van a pasar todos los operarios del turno. Va en la misma ruta que el
// inventario porque es la misma pantalla del §5.4 —el dueño lo instala y lo ve aparecer en la
// lista— y porque su cruce de tenant ya está declarado ahí.
//
// EL SECRETO SE DEVUELVE UNA VEZ Y NO SE PUEDE VOLVER A PEDIR: en la base queda solo su hash
// (§4.3). El dueño tiene el aparato delante mientras lo instala, que es el único momento en que
// hay dónde ponerlo.
export async function POST() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const enrolado = await enActo(
    g.acto.pool,
    (c) => enrolarAnden(c, { sesion: g.acto.sesion }),
    g.acto.sesion,
  );
  return Response.json(enrolado, { status: 201 });
}
