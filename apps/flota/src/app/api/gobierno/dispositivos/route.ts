import { headers } from "next/headers";
import { guardia, inventarioDeDispositivos } from "../../../../servidor/gobierno.ts";

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
