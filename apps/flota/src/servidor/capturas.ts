import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION, esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El aterrizaje de las capturas del POD que trae el replay del outbox [AC-FPOD-03] — §4.2
// (regla de oro), §4.6 (eventos append-only, doble reloj, `client_uuid`), §5.2 F4, §3.E1.7.
//
// ─── ESTA ES LA MITAD QUE HACE VERDADERA LA OTRA ──────────────────────────────────
//
// «Al volver la señal el replay vacía la cola sin intervención del operario» es una frase con
// dos sujetos: el aparato, que reintenta solo, y el servidor, que de verdad se queda con lo que
// le llega. Sin este segundo, vaciar la cola sería BORRARLA — y la pantalla diría «sincronizado»
// sobre entregas que no existen en ninguna parte. Es exactamente el antipatrón de la foto del
// POD que «subía» hasheando un texto (aprendizaje de AGENTS.md), y por eso acá el hecho aterriza
// en `eventos`, que el §4.6 declara ORDEN AUTORITATIVO del tenant y origen de toda proyección.
//
// ─── LO QUE ESTE AC NO HACE ───────────────────────────────────────────────────────
//
// La fila `entregas_pod` con el detalle write-once + supersede es AC-FPOD-11; el catálogo de
// degradaciones (SOC fuera de rango, odómetro menor, el drift de reloj del §0 ⇒ flag + `review_queue`) es
// AC-FPOD-05; el replay DOBLE probado contra la doble llave del §4.6 es AC-FPOD-04. Acá está el
// mínimo que hace del vaciado de la cola un hecho y no un borrado: el evento con su doble reloj,
// su `client_uuid` y el detalle de la variante en el payload.
//
// ─── POR QUÉ NO SE VALIDA LA PARADA ───────────────────────────────────────────────
//
// El §4.2 pone la validación BLOQUEANTE en el cliente, contra el snapshot congelado del turno, y
// deja a este lado sin derecho a decir que no: el mundo físico ya ocurrió. Una parada que no
// está en esta base no es motivo de rebote — y tampoco es una fuga: cada tenant es una BD propia
// (§4.1), así que una captura con el identificador de una parada del vecino aterriza en la base
// de QUIEN la manda y deja la del vecino sin una sola fila (§9.3.2, centinela 2).
//
// Lo único que rebota 422 es lo que no es una captura: un cuerpo sin `client_uuid`, sin parada o
// con una hora del aparato ilegible. Eso no es un dato del terreno degradado, es una llamada mal
// formada, y guardarla en silencio dejaría hechos sin sujeto ni reloj.

/** Una captura tal como viaja desde el outbox: snake_case, como el resto del contrato HTTP. */
export type CapturaEntrante = {
  clientUuid: string;
  paradaId: string;
  tsDispositivo: Date;
  tzOffsetMin: number;
  resultado: string;
  metodoEntrega: string | null;
  motivoId: string | null;
  items: unknown;
  evidencias: unknown;
};

/** El acuse por captura. `aceptada` es lo que el aparato usa para SACARLA de la cola: sin ese
 *  acuse la captura se queda, que es lo que impide que un 2xx vacíe una cola sin guardar nada. */
export type AcuseDeCaptura = { client_uuid: string; aceptada: true; repetida: boolean };

/** Las cuatro salidas de F4 (§4.5: `resultado exito|fallo|parcial`). */
const RESULTADOS = ["exito", "fallo", "parcial"];

export function capturaBienFormada(c: Partial<CapturaEntrante>): boolean {
  return (
    typeof c.clientUuid === "string" &&
    esUuid(c.clientUuid) &&
    typeof c.paradaId === "string" &&
    esUuid(c.paradaId) &&
    c.tsDispositivo instanceof Date &&
    !Number.isNaN(c.tsDispositivo.getTime()) &&
    Number.isInteger(c.tzOffsetMin) &&
    typeof c.resultado === "string" &&
    RESULTADOS.includes(c.resultado)
  );
}

/**
 * Aterriza un LOTE de capturas. En lote porque lo que el aparato tiene que vaciar es una cola:
 * mandarlas de a una obligaría a coordinar N respuestas para saber si quedó vacía, y en el
 * subterráneo donde la señal vuelve por diez segundos, N viajes son N oportunidades de cortarse.
 *
 * Cada captura se resuelve por separado dentro de UNA transacción: el replay del outbox trae
 * capturas de paradas distintas y de horas distintas, y una que falle no puede llevarse las que
 * ya estaban bien — pero tampoco pueden aterrizar a medias, porque lo que el aparato borra de su
 * cola es lo que este acuse le confirma.
 */
export async function aterrizarCapturas(
  pool: Pool,
  sesion: Sesion,
  entrantes: CapturaEntrante[],
): Promise<AcuseDeCaptura[]> {
  if (entrantes.length === 0) return [];

  return enActo(
    pool,
    async (c) => {
      const acuses: AcuseDeCaptura[] = [];
      for (const captura of entrantes) {
        // El replay es el camino PRINCIPAL (§4.7), así que llega repetido por diseño: al
        // arrancar la app y al volver la señal. Se pregunta ANTES de insertar porque
        // `UNIQUE(tenant_id, client_uuid)` rebota 23505 y ese rebote se llevaría puesto el lote
        // entero — la idempotencia del §0 tiene que verse como «ya estaba», no como un error.
        const { rows: previo } = await c.query<{ id: string }>(
          "select id::text as id from eventos where client_uuid = $1",
          [captura.clientUuid],
        );
        if (previo[0]) {
          acuses.push({ client_uuid: captura.clientUuid, aceptada: true, repetida: true });
          continue;
        }

        await registrarEvento(c, {
          codigo: EVENTOS_OPERACION.entrega_pod_capturada,
          objetoTabla: "paradas",
          objetoId: captura.paradaId,
          sesion,
          // El doble reloj del §4.6: `event_time` es cuándo el chofer tocó «Entregado» —puede
          // ser de hace tres horas, sin señal— y `record_time` lo pone la BD al aterrizar.
          eventTime: captura.tsDispositivo,
          tzOffsetMin: captura.tzOffsetMin,
          clientUuid: captura.clientUuid,
          payload: {
            resultado: captura.resultado,
            metodo_entrega: captura.metodoEntrega,
            motivo_id: captura.motivoId,
            items: captura.items ?? null,
            evidencias: captura.evidencias ?? [],
          },
        });
        acuses.push({ client_uuid: captura.clientUuid, aceptada: true, repetida: false });
      }
      return acuses;
    },
    sesion,
  );
}
