import { createHash } from "node:crypto";
import { tarjetasNivelCero } from "../../../../dominio/semaforo.ts";
import { seedA, seedC } from "../../../../dominio/semaforo-fixtures.ts";

// El digest del semáforo — refresco [AC-FSEM-06] — spec 05 §2.6, §4.
//
// La evaluación real de `signal_rule` contra eventos/paradas/client_metric (AC-FSEM-07/08/16-19)
// y la guardia de sesión con manifest por rol («GET al digest ⇒ 403», AC-FSEM-09) no existen
// todavía — mismo alcance que `hoy/page.tsx` declara para AC-FSEM-01: este endpoint sirve el
// Nivel 0 sobre las semillas del maestro (`?seed=a|c`) para que el REFRESCO —lo único que pide
// este AC: polling con pestaña visible, ETag/304, offline con digest viejo marcado— se pueda
// construir y probar de verdad hoy, sin bloquear en una migración que el motor no puede escribir
// (AGENTS.md). Sin identificador de recurso y sin sesión: la respuesta es literal del fixture,
// nunca un dato de ningún tenant (manifiesto de rutas, caso `sin_recurso`).
//
// El ETag se calcula SOLO sobre `tarjetas` (no sobre un timestamp) para que el mismo seed
// devuelva SIEMPRE el mismo ETag entre pedidos — si no, `If-None-Match` nunca calzaría y el 304
// jamás ocurriría, que es exactamente el caso que este AC pide probar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const seed = url.searchParams.get("seed") === "c" ? "c" : "a";
  const tarjetas = tarjetasNivelCero(seed === "c" ? seedC() : seedA());
  const etag = `"${createHash("sha256").update(JSON.stringify(tarjetas)).digest("hex")}"`;
  const cabeceras = { ETag: etag, "Cache-Control": "no-store" };

  if (peticion.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cabeceras });
  }
  return Response.json({ tarjetas }, { headers: cabeceras });
}
