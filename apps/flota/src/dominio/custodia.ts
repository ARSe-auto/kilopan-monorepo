import { RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";

// La degradación de una captura de custodia [AC-FRUT-10] — §4.2, §4.6, §0, §9.3.1, §9.3.4.
//
// ─── NINGUNA DE ESTAS CONDICIONES RECHAZA. ESA ES TODA LA REGLA ─────────────────────
//
// La custodia está nombrada con todas las letras en la lista CAPTURA del §4.2: cuando esto
// llega, el camión ya se cargó y ya salió. Un 422 no le devuelve al andén el conteo que hizo a
// las cuatro de la mañana — se lo borra, y con él la única constancia de qué subió, de quién y
// contra qué papel. Tres semanas después, cuando el cliente dice que faltaron seis bandejas, esa
// fila que no se escribió es la que habría contestado.
//
// Lo que sí se hace es DEJAR DICHO que algo no cuadra: flag + evento + fila en `review_queue`.
// La diferencia entre eso y rebotar es la diferencia entre «lo tenemos y sabemos que hay que
// mirarlo» y «no lo tenemos».
//
// ─── Y LA CONTRACARA, QUE ES LA MITAD QUE SE OLVIDA ─────────────────────────────────
//
// Una captura LIMPIA no deja flag ni fila en «Por revisar». Suena obvio y es lo primero que se
// pierde: marcar de más es barato de escribir y sale gratis en el momento, pero la cola Por
// revisar del §5.6 tiene que tender a cero cada día, y una bandeja que amanece con cien filas
// deja de mirarse en una semana. Ahí se pierden las cinco que importaban. Por eso se degrada
// SOLO la validación que falla, y por eso el caso (a) del AC es un test propio.
//
// ─── LOS CINCO CASOS, Y POR QUÉ CADA UNO ES UN FLAG Y NO UN RECHAZO ─────────────────
//
//   · `manifiesto_incompleto` — el andén confirmó sabiendo que faltaba contar. Es la ÚNICA
//     modal del sistema (§7.6) y ya se respondió en terreno: repetir la pregunta en el servidor
//     no agrega información, solo pierde el conteo.
//   · `item_sin_dte` — mercadería a bordo sin documento (art. 55 DL 825). El gate BLOQUEA en el
//     andén, con la vía explícita «bajar del manifiesto» (AC-FRUT-08). Si igual llegó por sync,
//     el camión ya está en la calle: rebotar no lo baja, solo borra la prueba de que salió así.
//   · `reloj_desfasado` — el §0 lo dice literal: pasado el drift máximo ⇒ flag, jamás rebote (el
//     umbral es `RELOJ.drift_max_minutos` y no se repite acá). El teléfono
//     del andén con la hora corrida no es un dato falso, es un dato con la hora corrida.
//   · `modulo_apagado` — el dueño apagó algo en una oficina y el andén ya había contado con el
//     turno abierto. La captura entra y manda su `config_version_id` (§0, §4.4).
//   · `sha256_mismatch` — el hash viaja en la mutación ANTES que el binario (§4.6). Si el
//     binario que llega después no re-hashea igual, la foto no es la que se prometió — pero el
//     CONTEO sigue valiendo, y la foto es mejora progresiva, jamás dependencia (§7.6).

export const FLAGS_DE_CUSTODIA = [
  "manifiesto_incompleto",
  "item_sin_dte",
  "reloj_desfasado",
  "modulo_apagado",
  "sha256_mismatch",
] as const;
export type FlagDeCustodia = (typeof FLAGS_DE_CUSTODIA)[number];

export type CapturaDeCustodia = {
  /** Cuántos ítems declaraba la parada para esta empresa, y cuántos quedaron contados. */
  itemsDeclarados: number;
  itemsContados: number;
  /** El andén confirmó la modal de manifiesto incompleto (§7.6). */
  incompletoConfirmado: boolean;
  /** Ítems a bordo sin `reference_document` y sin bajar (§7.3, art. 55 DL 825). */
  itemsSinDte: number;
  /** El doble reloj del §4.6: cuándo lo capturó el aparato y cuándo lo supo el servidor. */
  tsDispositivo: Date;
  recibidaEn: Date;
  /** Si el módulo estaba encendido en la config CONGELADA del turno (§4.4, §5.5). */
  moduloEncendido: boolean;
  /** El sha256 que viajó en la mutación, y el del binario re-hasheado (§4.6). `null` cuando no
   *  hay foto: la mayoría de las capturas del andén no la traen, y eso no es una degradación. */
  shaPrometido: string | null;
  shaRecalculado: string | null;
};

/** Milisegundos de desfase tolerado entre el reloj del aparato y el del servidor (§0). */
const TOLERANCIA_DE_RELOJ_MS = RELOJ.drift_max_minutos * 60 * 1000;

/**
 * Qué tiene de raro esta captura de custodia. Lista vacía = nada, y entonces no hay flag, ni
 * evento de degradación, ni fila en «Por revisar».
 *
 * Función pura y separada del servidor a propósito: el mismo juicio lo necesita el CLIENTE para
 * avisar ANTES de sincronizar (§4.2, «la validación bloqueante corre en el cliente»), y dos
 * copias del criterio se separan el día que alguien ajusta una.
 */
export function clasificarCustodia(captura: CapturaDeCustodia): FlagDeCustodia[] {
  const flags: FlagDeCustodia[] = [];

  // Dos vías a la misma conclusión, y las dos hacen falta. La modal la responde el andén cuando
  // SABE que faltó contar; la cobertura la mide el servidor sobre lo que efectivamente llegó, y
  // atrapa el caso en que el aparato ni siquiera preguntó — un outbox que sincronizó a medias no
  // tiene forma de confirmar nada.
  if (captura.incompletoConfirmado || captura.itemsContados < captura.itemsDeclarados) {
    flags.push("manifiesto_incompleto");
  }
  if (captura.itemsSinDte > 0) flags.push("item_sin_dte");
  if (!captura.moduloEncendido) flags.push("modulo_apagado");

  // Valor absoluto: un reloj adelantado es tan sospechoso como uno atrasado, y solo uno de los
  // dos signos se ve si se compara sin él.
  const desfase = Math.abs(captura.recibidaEn.getTime() - captura.tsDispositivo.getTime());
  if (desfase > TOLERANCIA_DE_RELOJ_MS) flags.push("reloj_desfasado");

  // Sin promesa no hay mismatch: una captura sin foto no está degradada, le falta una mejora
  // progresiva. Y sin binario tampoco: el hash viaja ANTES, así que entre la mutación y la
  // subida hay un rato en que solo existe la promesa y eso es lo normal (§4.6).
  if (
    captura.shaPrometido !== null &&
    captura.shaRecalculado !== null &&
    captura.shaPrometido.toLowerCase() !== captura.shaRecalculado.toLowerCase()
  ) {
    flags.push("sha256_mismatch");
  }

  return flags;
}

/**
 * ¿Alguna combinación de flags rechaza la captura? NO, y por eso existe esta función: el §4.2 y
 * el centinela 4 necesitan algo concreto que asertar, y una promesa que solo vive en un
 * comentario no se puede poner roja.
 */
export function rechaza(_flags: readonly FlagDeCustodia[]): boolean {
  return false;
}

/**
 * Con qué severidad entra a la bandeja «Por revisar» (§5.6).
 *
 * `media`, la misma que las lecturas y por la misma razón: son anomalías de una captura que el
 * terreno explica —faltó contar, el teléfono tenía la hora corrida, la foto no subió entera—, no
 * incidentes. La `alta` está reservada para lo que ya no se explica así (un aparato revocado que
 * sigue sincronizando, §4.3; un break-glass, §7.9), y gastarla acá haría que la bandeja dejara de
 * distinguir entre una foto cortada y alguien entrando a la base.
 */
export const SEVERIDAD_DE_CUSTODIA = "media";
