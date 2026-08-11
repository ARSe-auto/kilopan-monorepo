import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { esUuid } from "../../../servidor/gobierno.ts";
import { poolDe } from "../../../servidor/conexion.ts";
import CierreDeRuta from "./cierre-de-ruta.tsx";

// La envoltura de servidor de la pantalla de cierre [AC-FRUT-11] — §0 (contrato HTTP), §7.2,
// §9.3.2 (centinela 2).
//
// ─── POR QUÉ LA RUTA VIAJA EN LA CONSULTA Y NO EN EL CAMINO ───────────────────────
//
// Ninguna pantalla de este producto recibe un identificador como SEGMENTO de la URL, y esta
// tampoco. No es estética: el App Router serializa el árbol de segmentos —con el valor concreto
// del parámetro— dentro del HTML que sirve, incluso en el 404. O sea que una pantalla
// `/ruta/<id>/cerrar` devuelve ese id en su cuerpo pase lo que pase, y el centinela 2 exige que
// la respuesta servida a A no traiga NI UNA cadena del vecino. La casa entera resuelve esto
// igual: el tenant sale del ruteo por host y lo que se mira va en el cuerpo o en la consulta.
//
// ─── Y AUN ASÍ, UNA RUTA AJENA MUERE ACÁ ─────────────────────────────────────────
//
// La existencia se resuelve ANTES de pintar nada. El tenant no sale de la URL ni de una cabecera
// de afuera: lo sobrescribe el ruteo por host (`servidor.mjs`), que es lo único que no se puede
// falsificar desde el navegador. Un identificador que no está en ESA base no existe: 404 —el
// mismo que da un id inventado—, jamás un 403 que confirme que la ruta es de alguien.
//
// La sesión no se mira acá y no es un olvido: el secreto del aparato vive en IndexedDB y jamás
// viaja en el pedido del documento (§4.3). Quien decide qué DATOS salen es la API —que sí exige
// sesión y está declarada como recurso en el manifiesto—; esta envoltura solo decide si la ruta
// es de la casa.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const consulta = await searchParams;
  const pedida = Array.isArray(consulta.ruta) ? consulta.ruta[0] : consulta.ruta;
  const bd = (await headers()).get("x-flota-tenant-bd");
  // Mal formado, ausente y de otra casa se ven IGUAL, por la misma razón que en la API: un 500
  // por `22P02` distinguiría «id inválido» de «id que no está», y esa distinción es media
  // enumeración.
  if (!bd || !pedida || !esUuid(pedida)) notFound();

  const { rows } = await poolDe(bd).query("select 1 from rutas where id = $1", [pedida]);
  if (!rows[0]) notFound();

  return <CierreDeRuta rutaId={pedida} />;
}
