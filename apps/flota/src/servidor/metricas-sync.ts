import type { Pool } from "pg";
import { enActo, esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El aterrizaje genérico de `client_metric` en LOTE por el MISMO endpoint de sync [AC-FPOD-14]
// — §4.6, §4.2 R1 (regla de oro), §0 (client_uuid UNIQUE). Mismo criterio que
// `servidor/recarga-sync.ts` (AC-FPOD-13): otra clase de captura que viaja por el MISMO outbox,
// jamás su propio mecanismo.
//
// `cliente/toques-flujo.ts` (AC-FRUT-19) ya arma la fila y la manda por acá; hasta este AC el
// endpoint la ignoraba en silencio (`cuerpo.metricas` no era ni `capturas` ni `recargas`, así
// que el 2xx salía igual pero sin aterrizar nada) y `e2e/toques-flujo.spec.ts` tuvo que fixturear
// el INSERT con `page.route`. Este AC es el aterrizaje REAL: el mismo POST que hoy vacía la cola
// de POD y de recarga también vacía la de telemetría.
//
// La cláusula «los paneles del §10 leen SOLO de `client_metric` y eventos» (§4.6) NO se verifica
// acá — es del módulo 05 (semáforo), dueño de esos paneles (spec 04 «Dependencias»).

export const TIPOS_DE_METRICA = [
  "toques_flujo",
  "eviccion_idb",
  "persist_denegado",
  "outbox_profundidad",
  "outbox_edad_max",
  "pwa_version",
  "sync_error",
  "latencia_ms",
] as const;

export type TipoDeMetrica = (typeof TIPOS_DE_METRICA)[number];

function esTipoDeMetrica(valor: unknown): valor is TipoDeMetrica {
  return typeof valor === "string" && (TIPOS_DE_METRICA as readonly string[]).includes(valor);
}

/** Una fila de `client_metric` tal como viaja desde el outbox — mismo patrón que
 *  `RecargaCapturaEntrante` de `servidor/recarga-sync.ts`. */
export type MetricaEntrante = {
  clientUuid: string;
  tipo: TipoDeMetrica;
  flujo: string | null;
  valorInt: number;
  tsDispositivo: Date;
  tzOffsetMin: number;
};

/** El acuse por métrica. Mismo contrato que `AcuseDeCaptura`/`AcuseDeRecarga`: el aparato la saca
 *  de su cola con `aceptada: true`, siempre — CAPTURA jamás rebota (§4.2). */
export type AcuseDeMetrica = { client_uuid: string; aceptada: true; repetida: boolean };

/** Filtra SOLO llamadas mal formadas —sin `client_uuid`, sin `tipo` del catálogo, valor no
 *  entero, hora ilegible—: eso es un cuerpo sin sujeto ni reloj, no una medición degradada
 *  (mismo criterio que `capturaBienFormada`/`capturaDeRecargaBienFormada`). */
export function metricaBienFormada(m: Partial<MetricaEntrante>): boolean {
  return (
    typeof m.clientUuid === "string" &&
    esUuid(m.clientUuid) &&
    esTipoDeMetrica(m.tipo) &&
    (m.flujo === null || m.flujo === undefined || typeof m.flujo === "string") &&
    Number.isInteger(m.valorInt) &&
    m.tsDispositivo instanceof Date &&
    !Number.isNaN(m.tsDispositivo.getTime()) &&
    Number.isInteger(m.tzOffsetMin)
  );
}

/**
 * Aterriza un LOTE de métricas del cliente, una por una: `client_uuid` es la llave de
 * idempotencia (`unique(tenant_id, client_uuid)`, §0) — a diferencia de `eventos`, una métrica
 * repetida no escribe flag ni fila de revisión, se descarta en silencio: un reintento del
 * outbox no es un hecho nuevo que revisar, es el mismo hecho que ya quedó medido.
 */
export async function aterrizarMetricas(
  pool: Pool,
  sesion: Sesion,
  entrantes: MetricaEntrante[],
): Promise<AcuseDeMetrica[]> {
  if (entrantes.length === 0) return [];

  return enActo(
    pool,
    async (c) => {
      const acuses: AcuseDeMetrica[] = [];
      for (const m of entrantes) {
        const { rowCount } = await c.query(
          `insert into client_metric (tipo, flujo, valor_int, ts, tz_offset_min, client_uuid)
           values ($1, $2, $3, $4, $5, $6::uuid)
           on conflict (tenant_id, client_uuid) do nothing`,
          [m.tipo, m.flujo, m.valorInt, m.tsDispositivo, m.tzOffsetMin, m.clientUuid],
        );
        acuses.push({ client_uuid: m.clientUuid, aceptada: true, repetida: rowCount === 0 });
      }
      return acuses;
    },
    sesion,
  );
}
