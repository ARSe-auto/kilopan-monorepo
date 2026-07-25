"use client";
// AC-RED-01 (decisión #4): cola con reintento para pesaje y mostrador.
//
// Diferencia deliberada con el outbox del reparto: pesaje y mostrador NUNCA salen del
// LAN de la panadería, así que no hace falta descargar un snapshot del día ni resolver
// conflictos. Alcanza con una cola corta en memoria, respaldada en sessionStorage por
// si se recarga la pantalla a mitad de un corte, y reintento automático. El
// `client_uuid` sigue siendo la garantía de que un reintento no duplica nada.

const CLAVE = "kp_cola_local";

export interface ItemCola {
  clientUuid: string;
  ruta: string;
  payload: unknown;
  intentos: number;
}

function leer(): ItemCola[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.sessionStorage.getItem(CLAVE) ?? "[]") as ItemCola[];
  } catch {
    return [];
  }
}

function escribir(items: ItemCola[]) {
  window.sessionStorage.setItem(CLAVE, JSON.stringify(items));
}

export function pendientes(): number {
  return leer().length;
}

/** Envía ahora; si falla por red, encola y devuelve `encolado`. El llamador puede
 *  seguir trabajando: el pan no espera a que vuelva el wifi. */
export async function enviarOEncolar(
  ruta: string,
  payload: { clientUuid: string } & Record<string, unknown>
): Promise<"enviado" | "encolado" | { error: string }> {
  try {
    const r = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return "enviado";
    // Un rechazo del servidor (validación, stock, outlier) NO se encola: es una
    // respuesta legítima que el operador tiene que ver ahora.
    const cuerpo = await r.json().catch(() => ({}));
    return { error: cuerpo.error ?? `Error ${r.status}` };
  } catch {
    const cola = leer();
    cola.push({ clientUuid: payload.clientUuid, ruta, payload, intentos: 0 });
    escribir(cola);
    return "encolado";
  }
}

/** Reintenta la cola completa. Idempotente por client_uuid: reenviar de más es seguro. */
export async function reintentar(): Promise<number> {
  const cola = leer();
  if (cola.length === 0) return 0;

  const quedan: ItemCola[] = [];
  for (const item of cola) {
    try {
      const r = await fetch(item.ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      // 2xx = entró. 4xx = el servidor lo rechaza por una razón que no cambia con el
      // tiempo: sacarlo de la cola en vez de reintentar para siempre.
      if (!r.ok && r.status >= 500) quedan.push({ ...item, intentos: item.intentos + 1 });
    } catch {
      quedan.push({ ...item, intentos: item.intentos + 1 });
    }
  }
  escribir(quedan);
  return cola.length - quedan.length;
}

export function iniciarReintentoAutomatico(alCambiar: (n: number) => void): () => void {
  async function ciclo() {
    await reintentar().catch(() => 0);
    alCambiar(pendientes());
  }
  const intervalo = setInterval(ciclo, 15_000);
  window.addEventListener("online", ciclo);
  alCambiar(pendientes());
  return () => {
    clearInterval(intervalo);
    window.removeEventListener("online", ciclo);
  };
}
