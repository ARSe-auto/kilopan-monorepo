import type { NextRequest } from "next/server";

// AC-SEC-02: rate limit genérico en rutas de autenticación (además del bloqueo por PIN
// de AC-SEC-01, que es por usuario+dispositivo — esto es por IP, para frenar un
// barrido de RUTs distintos desde el mismo origen). Ventana deslizante en memoria: es
// honesto para un solo proceso; una instancia multi-nodo necesitaría un store
// compartido (Redis) — no aplica todavía a este MVP de un solo servidor.
const intentos = new Map<string, number[]>();

// Tanda 6 de la auditoría: `X-Forwarded-For` la escribe el CLIENTE — rotarla a mano
// bastaba para saltarse el límite entero. Next.js en runtime Node.js no expone el
// socket TCP crudo del request, así que la mitigación estándar es tomar el ÚLTIMO
// eslabón de la cadena: cada proxy AGREGA su propio hop al final, nunca reescribe los
// anteriores, así que ese último valor es el que puso el proxy de borde de Railway al
// recibir la conexión real — el cliente puede rellenar la cabecera con lo que quiera
// ANTES de eso, pero no puede escribir DESPUÉS de su propia conexión. Esto asume un
// solo hop de confianza (Railway) delante de la app; si algún día se agrega un CDN
// (Cloudflare, etc.) delante de Railway, hay que tomar el penúltimo valor, no el último.
export function ipDelCliente(request: NextRequest): string {
  const cadena = request.headers.get("x-forwarded-for");
  if (!cadena) return "desconocida";
  const saltos = cadena.split(",").map((s) => s.trim());
  return saltos[saltos.length - 1] || "desconocida";
}
const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = 20;

export function permitirIntento(claveIp: string): boolean {
  const ahora = Date.now();
  const previos = (intentos.get(claveIp) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (previos.length >= MAX_POR_VENTANA) {
    intentos.set(claveIp, previos);
    return false;
  }
  previos.push(ahora);
  intentos.set(claveIp, previos);
  return true;
}

// Solo para tests: evita que un test contamine a otro con estado global compartido.
export function _reiniciarParaTests() {
  intentos.clear();
}
