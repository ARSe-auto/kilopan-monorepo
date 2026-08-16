// Telemetría del propio módulo semáforo hacia el §10 [AC-FSEM-14] — spec 05 §5 («Telemetría del
// propio módulo»), maestro §10 (telemetría de producto y panel interno SaaS), §4.6
// (`client_metric` append-only con enum CERRADO · `review_queue`).
//
// El AC tiene oráculo PRODUCCIÓN (DONE-adopción del §10, dueño humano: Alexis): lo que se cierra
// con el piloto es la MEDICIÓN. Lo que este archivo construye es la mitad de software sin la cual
// el piloto no tendría nada que medir: la fila que el digest emite a telemetría de producto, y el
// agregado de «cola al cierre del día» que el panel del §10 renderiza.
//
// ─── POR QUÉ EL DIGEST VIAJA COMO `latencia_ms` Y NO COMO UN TIPO NUEVO ───────────────
//
// El §10 lista «digest del semáforo» dentro de la telemetría de producto, pero el enum
// `metrica_cliente` del §4.6 (migración 0002) es CERRADO y no trae tipo para el digest.
// Ampliarlo es DDL, y el esquema es de sesión supervisada — el mismo muro contra el que
// AC-FSEM-23 («minutos del dueño en el panel») y AC-FSEM-25 («hints re-mostrados») se detuvieron
// en vez de inventar un tipo. La medición que SÍ cabe en el catálogo existente sin torcer lo que
// su tipo significa es la LATENCIA con la que el digest llega a la pantalla del dueño:
// `latencia_ms` con `flujo='semaforo_digest'`. Es además el número que el §2.6 vuelve accionable
// —«Hoy» llega o no llega a tiempo— y el que el piloto necesita para decidir. `valor_int` sigue
// significando milisegundos, igual que en cualquier otra fila `latencia_ms` del producto.
//
// ─── POR QUÉ LA COLA ES UNA FUNCIÓN PURA SOBRE EL PAYLOAD ────────────────────────────
//
// Mismo criterio que `dominio/panel-saas.ts` (AC-FSEM-22) y `dominio/plano-eauto.ts`
// (AC-FSEM-10): el agregado se prueba contra el payload que el exportador empujaría, sin fetch.
// La fuente es el conteo de `review_queue` NO resuelta al cierre de cada jornada (spec 05 §5); el
// montaje autenticado contra `control` real es AC-FSEM-24 (pregunta 2).

/** El `flujo` con el que el digest se distingue de las demás filas `latencia_ms` del producto
 *  (§4.6: `flujo` es texto libre; el tipo es el que está cerrado). */
export const FLUJO_DIGEST_SEMAFORO = "semaforo_digest";

/** La fila de `client_metric` tal como viaja por el cable — mismas columnas del DDL (0002) y
 *  misma convención snake_case que `dominio/toques-flujo.ts::metricaDeToques`. */
export type MetricaDigestCruda = {
  tipo: "latencia_ms";
  flujo: typeof FLUJO_DIGEST_SEMAFORO;
  valor_int: number;
  client_uuid: string;
  ts: string;
  tz_offset_min: number;
};

/**
 * Arma la métrica del digest recién llegado a la pantalla. Devuelve `null` —y entonces no se
 * manda nada— cuando la latencia no es un número medido: negativa (reloj movido a mitad del
 * pedido) o no finita. Mismo criterio que `completarFlujo` con el flujo de cero toques: una fila
 * que no midió nada ensucia el p50/p95 del §10 sin decir nada.
 *
 * `valor_int` es `bigint` en la BD: la latencia se redondea a milisegundos enteros acá, no en el
 * servidor, para que lo que viaja por el cable sea exactamente lo que se guarda.
 */
export function metricaDeDigest(
  latenciaMs: number,
  clientUuid: string,
  ts: Date,
  tzOffsetMin: number,
): MetricaDigestCruda | null {
  if (!Number.isFinite(latenciaMs) || latenciaMs < 0) return null;
  return {
    tipo: "latencia_ms",
    flujo: FLUJO_DIGEST_SEMAFORO,
    valor_int: Math.round(latenciaMs),
    client_uuid: clientUuid,
    ts: ts.toISOString(),
    tz_offset_min: tzOffsetMin,
  };
}

// ─── «Cola al cierre del día tiende a cero» (§10 · spec 05 §5) ────────────────────────

/** Una jornada cerrada con su conteo de `review_queue` NO resuelta al cierre. `fecha` es el día
 *  local del tenant en ISO corto (`AAAA-MM-DD`) — la jornada, no un instante. */
export type CierreDeJornada = { fecha: string; pendientes: number };

export type ColaAlCierre = {
  /** Conteo del cierre más reciente de la ventana. `null` = ventana vacía: el panel declara que
   *  no hay medición, jamás un cero inventado (misma convención NULL del resto del módulo). */
  pendientesUltimoCierre: number | null;
  /** La ventana ordenada, más antigua primero — lo que el panel dibuja como tendencia. */
  tendencia: number[];
  /** La conducta que el §10 pide observar en el piloto. Una sola jornada NO es una tendencia:
   *  con menos de dos cierres esto es `false` aunque ese único día haya cerrado en cero. */
  tiendeACero: boolean;
  /** El otro lado del mismo hecho, y el que enciende la bandera: la cola creció de punta a punta
   *  de la ventana. Se compara con el extremo más viejo y no con el par final, mismo criterio que
   *  `contadorExenciones` de `panel-saas.ts`: una cola que sube y se aplana sigue sin tender a
   *  cero. */
  creciente: boolean;
};

/**
 * Agregado de la cola para el panel del §10. Rechaza el payload imposible en vez de dibujarlo:
 * un conteo negativo o no entero no es una cola degradada, es un exportador roto, y un panel que
 * lo promedia miente con cara de dato. Dos cierres del mismo día tampoco pasan: sería la misma
 * jornada contada dos veces en la tendencia.
 */
export function colaAlCierreDelDia(cierres: CierreDeJornada[]): ColaAlCierre {
  const vistas = new Set<string>();
  for (const c of cierres) {
    if (!Number.isInteger(c.pendientes) || c.pendientes < 0) {
      throw new Error(
        `«${c.fecha}» trae ${c.pendientes} pendientes: el conteo de review_queue es un entero ≥ 0 (§4.6)`,
      );
    }
    if (vistas.has(c.fecha)) throw new Error(`«${c.fecha}» viene dos veces: una jornada, un cierre`);
    vistas.add(c.fecha);
  }

  const ordenados = [...cierres].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const tendencia = ordenados.map((c) => c.pendientes);
  const ultimo = tendencia.at(-1);
  const primero = tendencia.at(0);
  if (ultimo === undefined || primero === undefined) {
    return { pendientesUltimoCierre: null, tendencia: [], tiendeACero: false, creciente: false };
  }
  return {
    pendientesUltimoCierre: ultimo,
    tendencia,
    // Tender a cero es haber llegado a cero o estar bajando: las dos son la conducta sana del
    // §10, y una cola que cerró en cero el último día ya cumplió el objetivo aunque el camino
    // haya tenido rebotes intermedios.
    tiendeACero: tendencia.length >= 2 && (ultimo === 0 || ultimo < primero),
    creciente: tendencia.length >= 2 && ultimo > primero,
  };
}
