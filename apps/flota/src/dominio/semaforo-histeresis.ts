import type { ColorSemaforo } from "./semaforo.ts";

// Histéresis por señal [AC-FSEM-02] — spec 05 §2.4: `signal_rule` guarda umbral_amarillo,
// umbral_rojo y umbral_recuperacion, este último DISTINTO del de disparo. Que sea distinto lo
// exige la BD y no esta función: el CHECK `signal_rule_histeresis` de la migración
// `db/migraciones-flota/tenant/0058_signal_rule_con_histeresis.sql`, ejercido por el pgTAP
// `db/flota/pgtap/0023_histeresis_de_senales.sql`. Acá se asume la fila ya válida.
//
// Lo que ESTA función construye, sin BD: la TRANSICIÓN de color dada la
// métrica actual y el color previo. Sin histéresis, una señal justo en el borde del umbral
// de disparo prendería y apagaría en cada poll (§0, comentario de `SEMAFORO.umbrales_por_senal`
// en constants.ts). La evaluación real contra `eventos`/`paradas`/`client_metric` es de los
// ACs por dominio (07/08/16-19), que además necesitan las mismas tablas del módulo 00.

export type UmbralesHisteresis = {
  umbral_amarillo: number;
  umbral_rojo: number;
  umbral_recuperacion: number;
};

/**
 * Convención de métrica ASCENDENTE: mayor valor = peor estado (p. ej. % de no-entregas,
 * minutos sin sync). Para señales descendentes (SOC, retorno proyectado) el dominio que
 * llame invierte el signo de la métrica y de los umbrales antes de llamar — la mecánica de
 * histéresis (disparo vs. recuperación, zona intermedia sticky) es la misma.
 */
export function transicionColor(
  colorPrevio: ColorSemaforo,
  metrica: number,
  umbrales: UmbralesHisteresis,
): ColorSemaforo {
  const { umbral_amarillo, umbral_rojo, umbral_recuperacion } = umbrales;
  if (metrica >= umbral_rojo) return "rojo";
  if (metrica >= umbral_amarillo) return "amarillo";
  if (metrica <= umbral_recuperacion) return "verde";
  // Zona intermedia: entre recuperación y disparo. No alcanza con bajar del umbral de
  // disparo para volver a verde — hay que cruzar la recuperación. Bajando desde rojo el
  // primer escalón es amarillo (misma mecánica que rojo→amarillo del enunciado del AC);
  // una señal que nunca alarmó (colorPrevio "verde") se queda en verde: no dispara sola
  // por aparecer en la zona intermedia sin haber cruzado el umbral de disparo antes.
  return colorPrevio === "rojo" ? "amarillo" : colorPrevio;
}
