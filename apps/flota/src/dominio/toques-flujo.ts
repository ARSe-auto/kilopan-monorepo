// Telemetría de toques-hasta-completar de los flujos del módulo [AC-FRUT-19] — §5.3, §4.6.
//
// ─── LA CONVENCIÓN ES LA MISMA QUE YA DEFIENDEN LOS e2e DE PRESUPUESTO ────────────
//
// El §5.3 fija una sola convención de conteo: «un campo de teclado propio = 1 acción, sea cual
// sea su cantidad de dígitos». Los e2e de AC-FRUT-01/05/07 ya la aplican del lado del TEST
// (contando clics). Esta función arma la fila que el CLIENTE manda con esa misma convención,
// para que los dos mecanismos —el e2e que cuenta eventos y `client_metric`— sean gemelos y no
// dos números que puedan divergir sin que nadie lo note (§5.3: «el e2e que cuenta eventos es el
// mecanismo gemelo, no un sustituto»).
//
// ─── POR QUÉ ES PURA ─────────────────────────────────────────────────────────────
//
// No toca `sessionStorage` ni el reloj: recibe el conteo, el `client_uuid` y el doble reloj ya
// resueltos, y devuelve la fila tal como viaja por el cable (snake_case, columnas de
// `client_metric` — misma convención que `cliente/outbox.ts::paraElCable`). Así se prueba sin
// navegador y sin red.

// `entrega_pod` (F4, AC-FPOD-14) es el mismo mecanismo aplicado al bucle de terreno del módulo
// 04: la parada de entrega también es un flujo con toques-hasta-completar, y el §5.3 no reserva
// la convención a los flujos del módulo 03.
export type FlujoDeToques =
  | "alta_encargo"
  | "publicar_dia"
  | "recepcion_custodia"
  | "cierre_ruta"
  | "entrega_pod";

/** La fila de `client_metric` tal como viaja por el cable — mismas columnas del DDL (0002). */
export type MetricaToquesFlujoCruda = {
  tipo: "toques_flujo";
  flujo: FlujoDeToques;
  valor_int: number;
  client_uuid: string;
  ts: string;
  tz_offset_min: number;
};

/**
 * Arma la métrica `toques_flujo` de un flujo COMPLETADO. `acciones` es el total acumulado desde
 * el último cierre de este flujo —toques-hasta-completar, no toques del último toque— porque un
 * intento que rebotó y se reintentó también le costó toques al operario.
 */
export function metricaDeToques(
  flujo: FlujoDeToques,
  acciones: number,
  clientUuid: string,
  ts: Date,
  tzOffsetMin: number,
): MetricaToquesFlujoCruda {
  return {
    tipo: "toques_flujo",
    flujo,
    valor_int: acciones,
    client_uuid: clientUuid,
    ts: ts.toISOString(),
    tz_offset_min: tzOffsetMin,
  };
}
