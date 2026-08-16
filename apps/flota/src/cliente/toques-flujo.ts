import { useCallback, useRef } from "react";
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
// de `metricas` en `client_metric` es `servidor/metricas-sync.ts::aterrizarMetricas` (AC-FPOD-14),
// wireado en el MISMO endpoint que ya recibe `capturas`/`recargas`.

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

// ─── DEUDA DEL MERGE (16-ago-2026) ─────────────────────────────────────────────
// Conviven DOS telemetrías de toques porque miden cosas distintas y cada una tiene su AC
// y sus pruebas: la de arriba cuenta el FLUJO completo de «publicar día» a través de tres
// pantallas [AC-FRUT-19] y la de abajo los toques REALES por campo del teclado propio,
// incluida cada «⌫» [AC-FMIG-03]. Lo que sí quedó duplicado es el CAMINO de salida:
// `/api/sync/capturas` (lote del outbox) y `/api/metricas/toques-flujo` (envío puntual).
// Unificarlos es trabajo de una sesión supervisada, no de este merge.

// AC-FMIG-03 — instrumentación de toques-hasta-completar por campo del teclado propio (§5.3,
// §4.6): la convención de presupuesto sigue contando el campo entero como 1 acción sin
// importar sus dígitos (eso lo cuentan los e2e de cada flujo, §5.3); esto mide los toques
// REALES —incluida cada «⌫» de corrección— y los manda a `client_metric` tipo `toques_flujo`,
// que es la métrica de producto que revela cuándo la vida en terreno se aleja del ideal de la
// convención.
export function useContadorDeToques() {
  const toques = useRef(0);
  const contar = useCallback(() => {
    toques.current += 1;
  }, []);
  const leerYReiniciar = useCallback(() => {
    const valor = toques.current;
    toques.current = 0;
    return valor;
  }, []);
  return { contar, leerYReiniciar };
}

/**
 * Envío puntual y best-effort — mismo criterio que `persist_denegado` en `servidor/entorno.ts`
 * y que `registrarToquesDrillDown` (AC-FSEM-05): no tiene sentido esperar el próximo lote del
 * outbox para saber cuántos toques tomó completar un campo, y perder la métrica ante un corte
 * de red no le cuesta nada a la captura real, que va por su propio camino.
 */
export function enviarToquesFlujo(flujo: string, toques: number): void {
  if (!Number.isInteger(toques) || toques < 1) return;
  void pedir("/api/metricas/toques-flujo", {
    method: "POST",
    body: JSON.stringify({ flujo, toques }),
  }).catch(() => {});
}
