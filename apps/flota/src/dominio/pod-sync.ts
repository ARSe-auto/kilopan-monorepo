import { RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";

// La regla de oro del motor de sync aplicada a la captura del POD [AC-FPOD-05] — §4.2, §4.6, §0,
// §9.3 centinela 4.
//
// ─── ESTE MÓDULO NO INVENTA UN CATÁLOGO NUEVO: REÚSA EL QUE YA EXISTE ───────────────
//
// El §4.2 fija la regla de oro UNA vez para toda la plataforma, y el AC de este archivo repite
// —como evidencia, no como trabajo pendiente— los mismos casos que AC-FVEH-05 ya cerró para
// `reading`: SOC declarado fuera de rango, odómetro menor al anterior, lectura fuera de perfil.
// Esos tres viven y se prueban en `dominio/lecturas.ts` porque son atributos de UNA lectura de
// vehículo, y la entrega del POD no lleva ninguno — reimplementarlos acá sería una segunda copia
// del mismo criterio, exactamente lo que el §4.2 pide evitar («dos copias se separan el día que
// alguien ajusta una»).
//
// Lo que SÍ es nuevo acá, porque es el único caso del centinela 4 que aplica a CUALQUIER
// mutación y no a una magnitud de vehículo, es el drift de reloj: «doble reloj event_time+tz_
// offset/record_time en TODA mutación» (§4.6) incluye la captura de POD, y hasta este AC el
// motor de `aterrizarCapturas` no lo miraba — la entrega aterrizaba con la hora que trajera el
// aparato, por desfasada que estuviera, sin flag ni fila en «Por revisar».
//
// ─── EL MÓDULO APAGADO CON TURNO ABIERTO [AC-FPOD-06] — §0 HTTP, §5.5, §4.4 ─────────
//
// Mismo criterio que `lecturas.ts` (AC-FVEH-18) y `custodia.ts` (AC-FRUT-10), aplicado acá
// porque la parada de POD vive bajo el mismo módulo de encargos/rutas (§0 «módulo apagado = 403
// SOLO en planificación/lectura; sync de captura = 2xx siempre… con flag `modulo_apagado`»). El
// juicio de si el módulo estaba encendido lo hace el SERVIDOR contra la config CONGELADA del
// turno (§4.4) — acá solo se recibe el veredicto y se marca.
//
// ─── NINGUNA CONDICIÓN RECHAZA. ESA ES TODA LA REGLA (§4.2, centinela 4) ────────────
//
// La entrega es CAPTURA: el chofer ya tocó «Entregado» y ya se fue de la parada. Un 422 acá no
// le devuelve la parada, se la borra. Lo que corresponde es DEJAR DICHO que algo no cuadra:
// flag + evento + fila en `review_queue`, y la captura aterriza igual.

export const FLAGS_DE_CAPTURA_POD = ["modulo_apagado", "reloj_desfasado"] as const;
export type FlagDeCapturaPod = (typeof FLAGS_DE_CAPTURA_POD)[number];

export type CapturaPod = {
  /** El doble reloj del §4.6: cuándo el chofer tocó «Entregado» (o cerró la variante que sea) y
   *  cuándo lo supo el servidor al aterrizar el evento. */
  tsDispositivo: Date;
  recibidaEn: Date;
  /** Si el módulo estaba encendido en la config CONGELADA del turno (§4.4, §5.5) [AC-FPOD-06].
   *  SIN CONFIGURAR cuenta como encendido — mismo motivo que `lecturas.ts`: el flag supone una
   *  acción humana con motivo, y leer la ausencia como «apagado» llenaría «Por revisar» de ruido
   *  desde el primer día de cada tenant. */
  moduloEncendido: boolean;
};

/** Milisegundos de desfase tolerado entre el reloj del aparato y el del servidor (§0). */
const TOLERANCIA_DE_RELOJ_MS = RELOJ.drift_max_minutos * 60 * 1000;

/**
 * Qué tiene de raro esta captura de POD. Lista vacía = nada, y entonces no hay flag, ni evento
 * de degradación, ni fila en «Por revisar».
 *
 * Función pura y separada del servidor a propósito: el mismo juicio lo necesita el CLIENTE para
 * avisar ANTES de sincronizar (§4.2), y dos copias del criterio se separan el día que alguien
 * ajusta una.
 */
export function clasificarCapturaPod(captura: CapturaPod): FlagDeCapturaPod[] {
  const flags: FlagDeCapturaPod[] = [];

  if (!captura.moduloEncendido) flags.push("modulo_apagado");

  // Valor absoluto: un reloj adelantado es tan sospechoso como uno atrasado, y solo uno de los
  // dos signos se ve si se compara sin él.
  const desfase = Math.abs(captura.recibidaEn.getTime() - captura.tsDispositivo.getTime());
  if (desfase > TOLERANCIA_DE_RELOJ_MS) flags.push("reloj_desfasado");

  return flags;
}

/**
 * ¿Alguna combinación de flags rechaza la captura? NO, y por eso existe esta función: el §4.2 y
 * el centinela 4 necesitan algo concreto que asertar, y una promesa que solo vive en un
 * comentario no se puede poner roja.
 */
export function rechaza(_flags: readonly FlagDeCapturaPod[]): boolean {
  return false;
}

/**
 * Con qué severidad entra a la bandeja «Por revisar» (§5.6). `media`, la misma que lecturas y
 * custodia y por la misma razón: es una anomalía que el terreno explica —el teléfono tenía la
 * hora corrida—, no un incidente.
 */
export const SEVERIDAD_DE_CAPTURA_POD = "media";
