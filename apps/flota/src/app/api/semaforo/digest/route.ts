import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { guardia } from "../../../../servidor/gobierno.ts";
import { tarjetasNivelCero } from "../../../../dominio/semaforo.ts";
import { seedA, seedC } from "../../../../dominio/semaforo-fixtures.ts";

// El digest del semáforo — refresco [AC-FSEM-06] y aislamiento/roles [AC-FSEM-09] — spec 05
// §2.6, §2.8, §4.
//
// La evaluación real de `signal_rule` contra eventos/paradas/client_metric (AC-FSEM-07/08/16-19)
// sigue sin existir — mismo alcance que `hoy/page.tsx` declara para AC-FSEM-01: este endpoint
// sirve el Nivel 0 sobre las semillas del maestro (`?seed=a|c`). Lo que SÍ existe desde este AC
// es la guardia: `guardia()` (§2.8 — el tablero es SOLO `admin_tenant`) es la MISMA puerta que
// ya usan reconocer/resolver/toques (AC-FSEM-04/05) — sin sesión ⇒ 404 pelado, sesión de un rol
// distinto de `admin_tenant` ⇒ 403 (chofer/responsable_carga/cliente/operador/
// responsable_tecnico, §2.8), recurso de otro tenant no aplica (`sin_recurso`, manifiesto de
// rutas). Como `review_queue`/`client_metric`/`signal_rule` no tienen ninguna columna de dinero
// (migraciones 0002 y 0058), la ausencia de plata para un rol vetado sale gratis de que esos
// roles no reciben NINGÚN dato — el grep de `semaforo-roles.spec.ts` vigila que eso siga siendo
// cierto.
//
// El ETag se calcula SOLO sobre `tarjetas` (no sobre un timestamp) para que el mismo seed
// devuelva SIEMPRE el mismo ETag entre pedidos — si no, `If-None-Match` nunca calzaría y el 304
// jamás ocurriría, que es exactamente el caso que AC-FSEM-06 pide probar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

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
