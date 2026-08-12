import type { Pool } from "pg";
import { esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { cerrarSesionDeRecarga, type RecargaEntrante } from "./energia.ts";

// El aterrizaje de cierres de recarga que trae el replay del MISMO outbox del POD [AC-FPOD-13]
// — §4.2 (regla de oro), §4.7 (outbox), §4.8 (dinero invisible), §9.3 centinela 10.
//
// ─── QUÉ REUSA Y QUÉ NO ────────────────────────────────────────────────────────────
//
// `cerrarSesionDeRecarga` (AC-FVEH-08, `servidor/energia.ts`) ya resuelve la idempotencia del
// replay vía `registrar_recarga` —SECURITY DEFINER porque la RLS del §4.8 le niega al chofer el
// SELECT que un `ON CONFLICT` necesitaría— y ya nunca manda un peso en la respuesta. Este
// módulo NO reimplementa nada de eso: solo lo llama en LOTE, para que el mismo POST de
// `/api/sync/capturas` que vacía la cola del POD también vacíe la cola de recarga. «El MISMO
// outbox» es, acá, literal: mismo endpoint, mismo acuse por `client_uuid`.
//
// ─── CERO REBOTES, TAMBIÉN ACÁ [AC-FPOD-13, §4.2, centinela 10 §9.3] ──────────────
//
// `capturaDeRecargaBienFormada` filtra SOLO llamadas mal formadas —sin `client_uuid`, sin
// vehículo, energía que no es un entero positivo, hora ilegible—: eso es un cuerpo sin sujeto
// ni reloj, no un dato del terreno degradado (mismo criterio que `servidor/capturas.ts`). Un
// `vehiculo_id` que no existe en esta base no es tráfico real —sale siempre del turno abierto
// del propio chofer, jamás lo teclea— pero si llegara, se acusa igual (`aceptada: true`) y sin
// fila: el §4.2 prohíbe devolverle al chofer una parada de la que ya se fue, y un solo item
// raro no puede llevarse puesto el acuse de las demás capturas del mismo lote.

/** Un cierre de recarga tal como viaja desde el outbox: snake_case en el cable, camelCase acá —
 *  mismo patrón que `CapturaEntrante` de `servidor/capturas.ts`. */
export type RecargaCapturaEntrante = {
  clientUuid: string;
  vehiculoId: string;
  turnoId: string | null;
  /** Energía en Wh ENTEROS (§0): la conversión desde los kWh del teclado la hace el cliente,
   *  `dominio/recarga-terreno.ts::whDesdeKwh` — acá solo se transporta. */
  wh: number;
  socInicial: number | null;
  socFinal: number | null;
  tsDispositivo: Date;
  tzOffsetMin: number;
};

/** El acuse por cierre de recarga. `aceptada` es lo que el aparato usa para sacarla de su cola —
 *  mismo contrato que `AcuseDeCaptura`. */
export type AcuseDeRecarga = { client_uuid: string; aceptada: true; repetida: boolean };

export function capturaDeRecargaBienFormada(c: Partial<RecargaCapturaEntrante>): boolean {
  return (
    typeof c.clientUuid === "string" &&
    esUuid(c.clientUuid) &&
    typeof c.vehiculoId === "string" &&
    esUuid(c.vehiculoId) &&
    (c.turnoId === null || c.turnoId === undefined || esUuid(c.turnoId)) &&
    Number.isInteger(c.wh) &&
    (c.wh as number) > 0 &&
    c.tsDispositivo instanceof Date &&
    !Number.isNaN(c.tsDispositivo.getTime()) &&
    Number.isInteger(c.tzOffsetMin)
  );
}

/**
 * Aterriza un LOTE de cierres de recarga, uno por uno: cada llamada a `cerrarSesionDeRecarga`
 * ya es su propia transacción idempotente (AC-FVEH-08), y el volumen real —como mucho un puñado
 * de sesiones de recarga por turno— no justifica rehacer el envoltorio transaccional en lote de
 * `aterrizarCapturas` para esto.
 */
export async function aterrizarRecargas(
  pool: Pool,
  sesion: Sesion,
  entrantes: RecargaCapturaEntrante[],
): Promise<AcuseDeRecarga[]> {
  const acuses: AcuseDeRecarga[] = [];
  for (const entrante of entrantes) {
    const entrada: RecargaEntrante = {
      vehiculoId: entrante.vehiculoId,
      turnoId: entrante.turnoId,
      wh: entrante.wh,
      socInicial: entrante.socInicial,
      socFinal: entrante.socFinal,
      clientUuid: entrante.clientUuid,
      tsDispositivo: entrante.tsDispositivo,
      tzOffsetMin: entrante.tzOffsetMin,
    };
    const resultado = await cerrarSesionDeRecarga(pool, sesion, entrada);
    if (resultado.tipo === "ok") {
      acuses.push({
        client_uuid: entrante.clientUuid,
        aceptada: true,
        repetida: resultado.recarga.repetida,
      });
    } else {
      // `vehiculo_no_existe` / `energia_invalida`: la formación ya filtró la segunda en el
      // tráfico real (wh entero positivo), y la primera no ocurre con un cliente que solo manda
      // SU PROPIO turno. Regla de oro (§4.2): se acusa igual, sin fila, para no dejar el resto
      // del lote sin vaciar su cola por un item que el terreno no produce.
      acuses.push({ client_uuid: entrante.clientUuid, aceptada: true, repetida: false });
    }
  }
  return acuses;
}
