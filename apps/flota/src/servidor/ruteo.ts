import { poolDe } from "./conexion.ts";
import { TENANT_ESTADOS, type TenantEstado } from "../../../../packages/nucleo-comun/src/constants.ts";

// Ruteo por subdominio → lookup en `control` → pool de SU base [AC-FTEN-05].
//
// El orden importa y es el del §4.1: primero se resuelve QUIÉN es el tenant contra el plano
// de control, y recién si está ACTIVO se toca su base. Al revés —abrir la base y después
// mirar el estado— un tenant suspendido ya habría dejado una conexión abierta contra sus
// datos, que es exactamente lo que la respuesta del dueño a la Pregunta 9 prohíbe.
//
// La semántica de fallo la dictó Alexis el 09-ago-2026: 404 · 503 · 404. El 404 del
// subdominio inexistente y el del archivado son EL MISMO a propósito: si difirieran, la
// diferencia sería el oráculo que revela qué subdominios existen.

/**
 * Dominio base del despliegue. El subdominio es lo que va delante; el resto es el dominio.
 * Se configura por entorno porque cambia entre desarrollo, staging y producción — no es una
 * decisión de producto sino de despliegue.
 */
const DOMINIO_BASE = process.env.FLOTA_DOMINIO_BASE || "flota.local";

export type Veredicto =
  | { tipo: "activo"; slug: string; bd: string }
  | { tipo: "sin_tenant" }
  | { tipo: "suspendido"; slug: string }
  | { tipo: "archivado"; slug: string };

/**
 * `a.flota.local` → `a`. Devuelve null cuando el host no es un subdominio del dominio base
 * (incluido el dominio pelado, que no es de ningún tenant).
 *
 * El puerto se descarta: `Host` lo trae en desarrollo y en cualquier despliegue detrás de un
 * proxy que no esté en el 80/443. Sin recortarlo, `a.flota.local:3311` no resolvía a ningún
 * tenant y todo el ruteo respondía 404 solo fuera de producción — el peor lugar donde tener
 * una diferencia de comportamiento, porque es donde se prueba.
 */
export function slugDeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const sinPuerto = host.split(":")[0]?.trim().toLowerCase();
  if (!sinPuerto) return null;
  const sufijo = `.${DOMINIO_BASE.toLowerCase()}`;
  if (!sinPuerto.endsWith(sufijo)) return null;
  const etiqueta = sinPuerto.slice(0, -sufijo.length);
  // Un solo nivel: `a.b.flota.local` no es el tenant `a.b` ni el tenant `b`. Aceptarlo
  // dejaría que un host cualquiera eligiera tenant con un punto de más.
  if (!etiqueta || etiqueta.includes(".")) return null;
  // Mismo alfabeto que el CHECK `tenants_slug_citable` de `control`: lo que no puede ser un
  // slug no vale la pena preguntárselo a la base.
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(etiqueta)) return null;
  return etiqueta;
}

function esEstado(valor: unknown): valor is TenantEstado {
  return TENANT_ESTADOS.includes(valor as TenantEstado);
}

/**
 * Resuelve el host contra `control`. NO abre la base del tenant: eso lo hace quien recibe un
 * veredicto `activo`.
 */
export async function resolverHost(host: string | null | undefined): Promise<Veredicto> {
  const slug = slugDeHost(host);
  if (!slug) return { tipo: "sin_tenant" };

  const { rows } = await poolDe("control").query<{ slug: string; bd: string; estado: string }>(
    "select slug, bd, estado::text as estado from tenants where slug = $1",
    [slug],
  );
  const fila = rows[0];
  if (!fila) return { tipo: "sin_tenant" };

  // Un estado que el código no conoce NO se sirve. El enum de la BD es cerrado, así que esto
  // solo puede pasar si alguien agregó un valor allá sin pasar por acá — y en esa ventana lo
  // seguro es no abrir la base, no adivinar que «se parece a activo».
  if (!esEstado(fila.estado)) return { tipo: "sin_tenant" };

  if (fila.estado === "suspendido") return { tipo: "suspendido", slug: fila.slug };
  if (fila.estado === "archivado") return { tipo: "archivado", slug: fila.slug };
  return { tipo: "activo", slug: fila.slug, bd: fila.bd };
}
