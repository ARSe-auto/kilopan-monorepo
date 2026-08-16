import { useCallback, useRef } from "react";
import { pedir } from "./aparato.ts";

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
