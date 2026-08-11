import type { CapturaDeEntrega } from "../dominio/pod-terreno.ts";

// El replay del outbox hacia el motor de sync [AC-FPOD-03] — §4.7 (replay-on-startup y
// replay-on-online son el camino PRINCIPAL), §4.2, §5.2 F4, §5.7, §3.E1.7.
//
// ─── SIN INTERVENCIÓN DEL OPERARIO, Y ESO INCLUYE NO MOSTRARLE EL FRACASO ─────────
//
// El §5.7 es literal: «las capturas JAMÁS muestran rechazo». Por eso `replayar` no tiene rama de
// error hacia afuera — un lote que no llegó devuelve CERO acuses y las capturas se quedan donde
// estaban, esperando el próximo intento. El chofer no ve un botón de reintentar porque no hay
// nada que él pueda decidir: reintentar es trabajo del aparato, no suyo.
//
// Que el Background Sync exista o no es indiferente (Safari no lo tiene, §4.7): el camino
// principal son los dos disparos que la pantalla arma —al montar y al volver la señal—, y jamás
// una dependencia de una API que la mitad de los teléfonos no trae (§7.6).

/** Lo que el endpoint acusa por captura (`servidor/capturas.ts`), en la forma en que viaja. */
type AcuseCrudo = { client_uuid?: unknown; aceptada?: unknown };

/** Cómo se manda el lote. Se recibe como parámetro para que el test lo ejerza sin `fetch` y sin
 *  servidor: el algoritmo del replay es lo que se prueba, no la red. */
export type Enviar = (cuerpo: string) => Promise<Response>;

/** Cada captura en el cuerpo del §0/§4.6: snake_case, con su llave de idempotencia y el doble
 *  reloj del aparato. Se arma acá y no en el componente porque es CONTRATO, no presentación. */
function paraElCable(c: CapturaDeEntrega) {
  return {
    client_uuid: c.clientUuid,
    parada_id: c.paradaId,
    ts_dispositivo: c.tsDispositivo,
    tz_offset_min: c.tzOffsetMin,
    resultado: c.resultado,
    metodo_entrega: c.metodoEntrega,
    motivo_id: c.motivoId,
    items: c.items,
    evidencias: c.evidencias,
  };
}

/**
 * Manda la cola y devuelve los `client_uuid` que el servidor CONFIRMÓ haber guardado.
 *
 * Devolver los acusados —y no un booleano— es lo que impide vaciar la cola por el código de
 * estado: un 2xx dice que la llamada llegó, y solo el acuse dice que el hecho quedó escrito.
 */
export async function replayar(cola: readonly CapturaDeEntrega[], enviar: Enviar): Promise<string[]> {
  if (cola.length === 0) return [];
  const respuesta = await enviar(JSON.stringify({ capturas: cola.map(paraElCable) })).catch(() => null);
  if (!respuesta || !respuesta.ok) return [];

  const cuerpo = (await respuesta.json().catch(() => null)) as { acuses?: AcuseCrudo[] } | null;
  if (!cuerpo || !Array.isArray(cuerpo.acuses)) return [];
  return cuerpo.acuses
    .filter((a) => a.aceptada === true && typeof a.client_uuid === "string")
    .map((a) => a.client_uuid as string);
}
