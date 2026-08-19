import type { Pool } from "pg";
import { enActo, esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El aterrizaje de `posiciones` en LOTE por el MISMO endpoint de sync [AC-FTEL-03] — §4.6, §4.2,
// §0 (client_uuid UNIQUE). Mismo criterio que `servidor/metricas-sync.ts`/`recarga-sync.ts`: otra
// clase de captura que viaja por el MISMO outbox, jamás su propio mecanismo — con UNA diferencia
// real: la privacidad del §7.8 (0074) hace que ESTA captura sí pueda rebotar, a propósito, cuando
// el turno ya cerró. El resto de las clases de captura jamás rebota al sincronizar (§4.2); esta es
// la única excepción explícita, documentada en la propia 0074. Por eso cada fila viaja bajo su
// propio SAVEPOINT: que el turno de UNA posición haya cerrado entre la captura y el replay no
// puede tumbar el resto del lote — ni las posiciones de OTROS turnos, ni las capturas, recargas o
// métricas que viajen en el mismo POST.

export type PosicionEntrante = {
  clientUuid: string;
  turnoId: string;
  lat: number;
  lng: number;
  precisionM: number | null;
  tsDispositivo: Date;
  tzOffsetMin: number;
};

/** El acuse por posición. `aceptada` es SIEMPRE `true` — también cuando el turno ya cerró y el
 *  punto se descartó (ver `aterrizarPosiciones`): reintentar por siempre un punto que la
 *  privacidad ya rechazó no es un reintento útil, y el §5.7 no le muestra un rechazo al chofer
 *  por algo que él no puede decidir. */
export type AcuseDePosicion = { client_uuid: string; aceptada: true; repetida: boolean };

/** El SQLSTATE del rebote de privacidad de la 0074 — mismo código que `servidor/posiciones.ts`
 *  traduce para la puerta directa de AC-FTEL-01. */
const CHECK_VIOLATION = "23514";

/** Filtra SOLO llamadas mal formadas — sin `client_uuid`, sin turno, lat/lng no numéricos, hora
 *  ilegible —: mismo criterio que `metricaBienFormada`. La caja de Chile y el turno abierto NO se
 *  validan acá: son invariantes de la BASE (0074, 0075), y validarlas dos veces las desalinea. */
export function posicionBienFormada(p: Partial<PosicionEntrante>): boolean {
  return (
    typeof p.clientUuid === "string" &&
    esUuid(p.clientUuid) &&
    typeof p.turnoId === "string" &&
    esUuid(p.turnoId) &&
    typeof p.lat === "number" &&
    Number.isFinite(p.lat) &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lng) &&
    (p.precisionM === null || (typeof p.precisionM === "number" && Number.isFinite(p.precisionM))) &&
    p.tsDispositivo instanceof Date &&
    !Number.isNaN(p.tsDispositivo.getTime()) &&
    Number.isInteger(p.tzOffsetMin)
  );
}

/**
 * Aterriza un LOTE de posiciones, una por una: `client_uuid` es la llave de idempotencia
 * (`unique(tenant_id, client_uuid)`, §0, centinela 1) — un replay doble deja exactamente una
 * fila. Cada INSERT viaja bajo su propio SAVEPOINT porque, a diferencia de toda otra captura del
 * §4.2, el trigger de la 0074 puede RECHAZAR una posición puntual (turno ya cerrado, §7.8): sin
 * el savepoint, ese único rechazo abortaría la transacción entera y con ella el resto del lote —
 * incluidas capturas, recargas o métricas de OTRO tenant de sesión que viajaran en el mismo POST.
 */
export async function aterrizarPosiciones(
  pool: Pool,
  sesion: Sesion,
  entrantes: PosicionEntrante[],
): Promise<AcuseDePosicion[]> {
  if (entrantes.length === 0) return [];

  return enActo(
    pool,
    async (c) => {
      const acuses: AcuseDePosicion[] = [];
      for (const p of entrantes) {
        await c.query("savepoint posicion");
        try {
          const { rowCount } = await c.query(
            `insert into posiciones (turno_id, lat, lng, capturada_en, tz_offset_min, precision_m, client_uuid)
             values ($1, $2, $3, $4, $5, $6, $7::uuid)
             on conflict (tenant_id, client_uuid) do nothing`,
            [p.turnoId, p.lat, p.lng, p.tsDispositivo, p.tzOffsetMin, p.precisionM, p.clientUuid],
          );
          await c.query("release savepoint posicion");
          acuses.push({ client_uuid: p.clientUuid, aceptada: true, repetida: rowCount === 0 });
        } catch (error) {
          await c.query("rollback to savepoint posicion");
          if ((error as { code?: string }).code === CHECK_VIOLATION) {
            // El turno cerró entre la captura y el replay (§7.8): el punto se descarta, no el
            // lote — 2xx-siempre sigue valiendo para el resto (§4.2).
            acuses.push({ client_uuid: p.clientUuid, aceptada: true, repetida: false });
            continue;
          }
          throw error;
        }
      }
      return acuses;
    },
    sesion,
  );
}
