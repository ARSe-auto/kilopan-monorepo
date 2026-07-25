// AC-SEC-02: rate limit genérico en rutas de autenticación (además del bloqueo por PIN
// de AC-SEC-01, que es por usuario+dispositivo — esto es por IP, para frenar un
// barrido de RUTs distintos desde el mismo origen). Ventana deslizante en memoria: es
// honesto para un solo proceso; una instancia multi-nodo necesitaría un store
// compartido (Redis) — no aplica todavía a este MVP de un solo servidor.
const intentos = new Map<string, number[]>();
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
