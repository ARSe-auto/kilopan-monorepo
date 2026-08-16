import { pedir } from "./aparato.ts";
import { metricaDeDigest } from "../dominio/telemetria-semaforo.ts";

// El lado del NAVEGADOR de la telemetría del digest [AC-FSEM-14] — spec 05 §5, §10, §4.6.
//
// Mismo mecanismo que `cliente/toques-flujo.ts` (AC-FRUT-19) y por la misma razón: la telemetría
// viaja por el MISMO endpoint de sync que ya vacía la cola de POD y de recarga (§4.6), jamás por
// un canal propio. El aterrizaje real es `servidor/metricas-sync.ts::aterrizarMetricas`.
//
// BEST-EFFORT SIN RAMA DE ERROR, igual que `completarFlujo`: si la métrica no llega, no hay nada
// que el dueño pueda decidir, y un cartel por una medición perdida le taparía el semáforo.

/** Manda la latencia del digest recién recibido. `void` a propósito: nadie espera este envío. */
export async function emitirLatenciaDeDigest(latenciaMs: number): Promise<void> {
  const metrica = metricaDeDigest(
    latenciaMs,
    crypto.randomUUID(),
    new Date(),
    -new Date().getTimezoneOffset(),
  );
  if (metrica === null) return;
  await pedir("/api/sync/capturas", {
    method: "POST",
    body: JSON.stringify({ metricas: [metrica] }),
  }).catch(() => null);
}
