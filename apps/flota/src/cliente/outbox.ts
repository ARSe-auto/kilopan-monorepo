import type { CapturaDeEntrega } from "../dominio/pod-terreno.ts";
import type { CapturaDeRecarga } from "../dominio/recarga-terreno.ts";
import type { CapturaDePosicion } from "../dominio/rastreo-terreno.ts";

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
    // La secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7: el servidor la usa para notar
    // un hueco (evicción del outbox o manipulación), nunca para rechazar.
    secuencia_dispositivo: c.secuenciaDispositivo,
    // El par supersede del undo post-replay [AC-FPOD-08] (§4.7). Viaja SIEMPRE, también en null:
    // un campo que aparece solo a veces obliga al servidor a distinguir «no supersede a nadie» de
    // «una versión vieja del cliente que no sabía del campo», y esas dos cosas se leen igual.
    supersede_de: c.supersedeDe,
    motivo: c.motivoSupersede,
  };
}

/**
 * Manda la cola y devuelve los `client_uuid` que el servidor CONFIRMÓ haber guardado.
 *
 * Devolver los acusados —y no un booleano— es lo que impide vaciar la cola por el código de
 * estado: un 2xx dice que la llamada llegó, y solo el acuse dice que el hecho quedó escrito.
 *
 * `enrolamiento` es la huella del enrolamiento QUE CAPTURÓ este lote [AC-FPOD-09] — §4.7: «las
 * capturas de A persisten FIRMADAS POR EL ENROLAMIENTO y se replayean aunque B esté
 * autenticado». En el camino normal quien transmite es quien capturó y va `null`: el servidor
 * atribuye a la sesión que manda, que es la misma. Viaja con valor solo cuando esas dos personas
 * son DISTINTAS —el flush de una partición ajena de `outbox-multiusuario.ts`—, que es el único
 * caso donde atribuir por la sesión que transmite le pondría la entrega de A en la planilla de B.
 */
export async function replayar(
  cola: readonly CapturaDeEntrega[],
  enviar: Enviar,
  enrolamiento: string | null = null,
): Promise<string[]> {
  if (cola.length === 0) return [];
  const respuesta = await enviar(
    JSON.stringify({ capturas: cola.map(paraElCable), enrolamiento }),
  ).catch(() => null);
  if (!respuesta || !respuesta.ok) return [];

  const cuerpo = (await respuesta.json().catch(() => null)) as { acuses?: AcuseCrudo[] } | null;
  if (!cuerpo || !Array.isArray(cuerpo.acuses)) return [];
  return cuerpo.acuses
    .filter((a) => a.aceptada === true && typeof a.client_uuid === "string")
    .map((a) => a.client_uuid as string);
}

// ─── EL MISMO REPLAY, PARA LA COLA DE RECARGA [AC-FPOD-13] — §4.7, §4.2 ───────────
//
// `replayarRecargas` es el gemelo de `replayar`: mismo algoritmo (nada sale de la cola salvo lo
// que el servidor ACUSÓ), mismo `Enviar` inyectable, mismo endpoint — `POST /api/sync/capturas`
// acepta un `recargas` junto al `capturas` existente, y es ese único endpoint el que hace
// literal la frase «el cierre de recarga viaja por el MISMO outbox».

/** Una recarga en el cuerpo del §0/§4.6: snake_case, sin `costo_clp` — el flujo del chofer no lo
 *  tiene (§4.8, centinela 10). */
function paraElCableRecarga(c: CapturaDeRecarga) {
  return {
    client_uuid: c.clientUuid,
    vehiculo_id: c.vehiculoId,
    turno_id: c.turnoId,
    wh: c.wh,
    soc_inicial: c.socInicial,
    soc_final: c.socFinal,
    ts_dispositivo: c.tsDispositivo,
    tz_offset_min: c.tzOffsetMin,
  };
}

/** Manda la cola de recarga y devuelve los `client_uuid` que el servidor CONFIRMÓ [AC-FPOD-13].
 *  Mismo criterio que `replayar`: un lote que no llegó no vacía nada, y no hay rama de error
 *  hacia afuera — el chofer no tiene nada que decidir sobre un reintento que es trabajo del
 *  aparato. */
export async function replayarRecargas(
  cola: readonly CapturaDeRecarga[],
  enviar: Enviar,
): Promise<string[]> {
  if (cola.length === 0) return [];
  const respuesta = await enviar(JSON.stringify({ recargas: cola.map(paraElCableRecarga) })).catch(
    () => null,
  );
  if (!respuesta || !respuesta.ok) return [];

  const cuerpo = (await respuesta.json().catch(() => null)) as { acuses_recarga?: AcuseCrudo[] } | null;
  if (!cuerpo || !Array.isArray(cuerpo.acuses_recarga)) return [];
  return cuerpo.acuses_recarga
    .filter((a) => a.aceptada === true && typeof a.client_uuid === "string")
    .map((a) => a.client_uuid as string);
}

// ─── EL MISMO REPLAY, PARA LA COLA DE POSICIÓN [AC-FTEL-03] — §4.6, §4.7, §4.2 ────
//
// `replayarPosiciones` es el tercer gemelo de `replayar`: mismo algoritmo, mismo `Enviar`
// inyectable, mismo endpoint — `POST /api/sync/capturas` acepta un `posiciones` junto a
// `capturas`/`recargas`, y es ese único endpoint el que hace literal la frase «la posición viaja
// por el MISMO motor de sync» (spec 09, AC-FTEL-03).

/** Una posición en el cuerpo del §0/§4.6: snake_case, con su llave de idempotencia y el doble
 *  reloj del aparato — mismo contrato que `paraElCable`/`paraElCableRecarga`. */
function paraElCablePosicion(p: CapturaDePosicion) {
  return {
    client_uuid: p.clientUuid,
    turno_id: p.turnoId,
    lat: p.lat,
    lng: p.lng,
    precision_m: p.precisionM,
    ts_dispositivo: p.tsDispositivo,
    tz_offset_min: p.tzOffsetMin,
  };
}

/** Manda la cola de posición y devuelve los `client_uuid` que el servidor CONFIRMÓ [AC-FTEL-03].
 *  Mismo criterio que `replayar`/`replayarRecargas`: un lote que no llegó no vacía nada, y no hay
 *  rama de error hacia afuera — el chofer no tiene nada que decidir sobre un reintento que es
 *  trabajo del aparato. */
export async function replayarPosiciones(
  cola: readonly CapturaDePosicion[],
  enviar: Enviar,
): Promise<string[]> {
  if (cola.length === 0) return [];
  const respuesta = await enviar(
    JSON.stringify({ posiciones: cola.map(paraElCablePosicion) }),
  ).catch(() => null);
  if (!respuesta || !respuesta.ok) return [];

  const cuerpo = (await respuesta.json().catch(() => null)) as { acuses_posiciones?: AcuseCrudo[] } | null;
  if (!cuerpo || !Array.isArray(cuerpo.acuses_posiciones)) return [];
  return cuerpo.acuses_posiciones
    .filter((a) => a.aceptada === true && typeof a.client_uuid === "string")
    .map((a) => a.client_uuid as string);
}
