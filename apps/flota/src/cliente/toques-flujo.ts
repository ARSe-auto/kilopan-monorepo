import { pedir } from "./aparato.ts";
import { metricaDeToques, type FlujoDeToques } from "../dominio/toques-flujo.ts";

// El lado del NAVEGADOR de la telemetría `toques_flujo` [AC-FRUT-19] — §5.3, §4.6.
//
// ─── POR QUÉ `sessionStorage` Y NO UN ESTADO DE COMPONENTE ────────────────────────
//
// «Publicar día» (§5.2 F1) recorre TRES pantallas —armar rutas → «Listos para salir» →
// publicar— y un estado de React no sobrevive a la navegación entre ellas. `sessionStorage` sí,
// y se pierde solo con la pestaña: exactamente la vida de un intento de completar el flujo.
//
// ─── POR QUÉ EL CONTADOR NO SE RESETEA AL FALLAR ──────────────────────────────────
//
// El §5.3 pide «toques-hasta-completar», no «toques del último intento»: un alta que rebotó por
// bultos fuera de rango y se corrigió le costó al operario los toques de las DOS pasadas. Por
// eso `registrarToque` solo SUMA, y `completarFlujo` es la única función que resetea — y lo hace
// recién cuando el flujo terminó de verdad.
//
// ─── POR QUÉ EL ENVÍO ES BEST-EFFORT, SIN RAMA DE ERROR ───────────────────────────
//
// Mismo criterio que `cliente/outbox.ts::replayar` (§5.7: «las capturas jamás muestran
// rechazo»): si el lote no llega, no hay nada que el operario pueda decidir. El aterrizaje real
// de `metricas` en `client_metric` es del motor de sync (AC-FPOD-14, módulo 04, todavía sin
// construir) — hasta que exista, este envío no hace nada en producción y no lo necesita: el
// formato ya es el definitivo, mismo endpoint, mismo POST que hoy recibe `capturas`/`recargas`.

const PREFIJO = "flota:toques:";

function leer(flujo: FlujoDeToques): number {
  if (typeof window === "undefined") return 0;
  const crudo = window.sessionStorage.getItem(PREFIJO + flujo);
  const n = crudo === null ? 0 : Number(crudo);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function escribir(flujo: FlujoDeToques, valor: number): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PREFIJO + flujo, String(valor));
}

/** Un toque real del operario en el flujo. Misma convención del §5.3 que ya aplican los e2e de
 *  presupuesto: un clic, un toque. */
export function registrarToque(flujo: FlujoDeToques): void {
  escribir(flujo, leer(flujo) + 1);
}

/** El campo de teclado propio cuenta 1 acción sin importar los dígitos (§5.3): se registra
 *  SOLO en la transición de vacío a no-vacío, para que tipear "30" no sume dos toques. */
export function alCambiarTeclado(flujo: FlujoDeToques, valorAnterior: string, valorNuevo: string): void {
  if (valorAnterior === "" && valorNuevo !== "") registrarToque(flujo);
}

/**
 * Cierra el flujo: arma la métrica con lo acumulado ENTERO y la manda por el MISMO endpoint de
 * sync (§4.6). Un flujo que no registró ningún toque no manda fila vacía —no hubo nada que
 * medir, y una fila en cero ensuciaría el p50/p95 del §10 sin decir nada.
 */
export async function completarFlujo(flujo: FlujoDeToques): Promise<void> {
  const acciones = leer(flujo);
  if (acciones === 0) return;
  escribir(flujo, 0);
  const metrica = metricaDeToques(
    flujo,
    acciones,
    crypto.randomUUID(),
    new Date(),
    -new Date().getTimezoneOffset(),
  );
  await pedir("/api/sync/capturas", {
    method: "POST",
    body: JSON.stringify({ metricas: [metrica] }),
  }).catch(() => null);
}
