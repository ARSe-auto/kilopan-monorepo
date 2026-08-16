import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { declararEntorno } from "../../../servidor/entorno.ts";

// El aparato declara su entorno mientras espera aprobación [AC-FIDN-05] — §4.3, §5.4, §4.6.
//
// PÚBLICO POR DEFINICIÓN, igual que `/api/solicitudes`: lo llama alguien que todavía no tiene
// sesión, porque justamente está esperando que se la den. Se identifica con la clave pública
// que ya viajó en su solicitud (ver `servidor/entorno.ts` para por qué esa y no un id).
//
// SIEMPRE 200, incluso cuando el entorno está incompleto — y esto NO contradice la regla de
// oro del §4.2. Declarar el entorno no es una PLANIFICACIÓN que pueda ser inválida: es una
// medición, y una medición que dice «acá falta persistencia» es un dato correcto, no un error
// del que la manda. Rebotarla dejaría a la pantalla sin con qué decidir qué mostrar —que es
// justo la degradación VISIBLE que el AC pide— y encima perdería la métrica.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(peticion: Request) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "datos_incompletos" }, { status: 422 });
  }

  const clavePublica = typeof cuerpo.clave_publica === "string" ? cuerpo.clave_publica.trim() : "";
  const clientUuid = typeof cuerpo.client_uuid === "string" ? cuerpo.client_uuid : "";
  if (!clavePublica || !UUID.test(clientUuid)) {
    return Response.json({ error: "datos_incompletos" }, { status: 422 });
  }

  // Las dos condiciones se leen como booleanos ESTRICTOS: cualquier cosa que no sea `true` es
  // «no concedido». Un `truthy` dejaría que un `"false"` de una serialización descuidada
  // contara como enrolamiento completo, que es exactamente el error que este AC existe para
  // que no ocurra en silencio.
  const isStandalone = cuerpo.is_standalone === true;
  const storagePersisted = cuerpo.storage_persisted === true;
  const tzOffsetMin = Number.isFinite(cuerpo.tz_offset_min) ? Number(cuerpo.tz_offset_min) : 0;

  const r = await declararEntorno(poolDe(bd), {
    clavePublica,
    clientUuid,
    tzOffsetMin,
    isStandalone,
    storagePersisted,
  });
  // Una solicitud que no está pendiente se ve igual que una que no existe: quien manda una
  // clave pública ajena no puede averiguar si esa persona ya fue aprobada.
  if (r.tipo === "sin_solicitud") return new Response(null, { status: 404 });

  return Response.json({
    completo: r.completo,
    is_standalone: isStandalone,
    storage_persisted: storagePersisted,
  });
}
