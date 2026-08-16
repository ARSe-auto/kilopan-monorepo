import { RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";
import { clasificar as clasificarRevocacion, revisionDe as revisionDeRevocacion } from "./revocacion.ts";

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
//
// ─── CAPTURA DE UN APARATO REVOCADO [AC-FPOD-07] — §4.3 ─────────────────────────────
//
// El corte del §5.4 F-F es SECO hacia adelante (el aparato revocado no vuelve a tener sesión),
// pero hacia atrás no se rechaza nada: lo que traía capturado de antes entra igual. Ese criterio
// —clasificar por cuán vieja es la ventana de `REVOCACION.ventana_horas`, jamás rechazar— ya lo
// resolvió `dominio/revocacion.ts` para AC-FIDN-09; este módulo lo REÚSA, no lo reimplementa
// (mismo principio que el drift de reloj de arriba: dos copias del mismo corte se separan el
// día que alguien mueve el umbral). Lo único nuevo acá es traducir su `ClaseDeCaptura` a un flag
// más del catálogo de esta captura.
//
// ─── El contrato de transporte del binario [AC-FPOD-19] — §4.6 ─────────────────────
//
// El §4.6 lo fija literal: «el sha256 viaja en la mutación ANTES del binario; mismatch al
// re-hashear ⇒ flag, no rebote». Mismo criterio que `dominio/custodia.ts` ya cerró para la foto
// del manifiesto (AC-FRUT-10) — acá se reúsa, no se reinventa: sin promesa no hay mismatch (una
// evidencia sin binario, como una firma, no tiene nada que comparar) y sin binario tampoco (el
// hash viaja ANTES, así que entre la mutación y la subida hay un rato en que solo existe la
// promesa, y eso es lo normal).

// ─── EL CANDADO DEL SERVIDOR SOBRE EL POD QUE LLEGA POR SYNC [AC-FRUT-23] — KR-29 ──
//
// El candado BLOQUEANTE es del cliente (§4.2): la tarjeta de la parada de entrega no ofrece
// «Llegué» mientras el sub-manifiesto por empresa de su parada de carga no esté confirmado
// (AC-FRUT-22). Pero «bloqueante en el cliente» no quiere decir «nadie mira del otro lado»: por
// el motor de sync llega lo que capturó una PWA vieja, un aparato que venía offline desde antes
// de que alguien bajara el ítem del manifiesto, o cualquiera que le pegue al endpoint. El §7.3
// pone en el manifiesto confirmado el ancla del art. 55 DL 825, así que un POD sin él es
// exactamente lo que hay que poder contar después.
//
// Y entra igual, como toda captura (§4.2, centinela 4 §9.3.4): el pan ya se entregó y un 422 no
// devuelve la parada, la borra. Lo que cambia respecto de los otros flags es la SEVERIDAD: alta,
// porque lo que quedó sin respaldo es documental, no la hora de un teléfono.
export const FLAGS_DE_CAPTURA_POD = [
  "modulo_apagado",
  "reloj_desfasado",
  "post_revocacion",
  "post_revocacion_tardia",
  "secuencia_hueco",
  "sha256_mismatch",
  "sin_manifiesto_confirmado",
] as const;
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
  /** Cuándo se revocó el aparato que mandó esta captura; `null` si sigue vigente [AC-FPOD-07].
   *  La sesión que resuelve esta captura NO es "válida" en ese caso —`sesionParaSincronizar
   *  Capturas` la deja pasar igual, a diferencia de cualquier otra ruta— así que este es el
   *  único dato de la revocación que le llega a este módulo. */
  revocadoEn: Date | null;
  /** Si la secuencia monotónica que trajo esta captura dejó un hueco respecto de la última que
   *  este dispositivo dejó aterrizar [AC-FPOD-10] — §4.7. Lo decide `servidor/capturas.ts` con
   *  `esHuecoDeSecuencia` contra `dispositivos.secuencia_maxima`: este módulo no toca la BD, solo
   *  traduce el veredicto a un flag más del mismo catálogo. */
  secuenciaHueco: boolean;
  /** El sha256 (hex) que viajó en la mutación de la captura, y el del binario re-hasheado por el
   *  servidor al recibirlo [AC-FPOD-19] — §4.6. Opcionales y `undefined`/`null` en la clasificación
   *  de la captura misma —que nunca lleva binario—; solo se completan cuando `servidor/capturas.ts`
   *  clasifica la SUBIDA del binario de una evidencia. */
  shaPrometido?: string | null;
  shaRecalculado?: string | null;
  /** Si el sub-manifiesto por empresa de la parada de carga que abastece esta entrega estaba
   *  confirmado cuando la captura aterrizó [AC-FRUT-23] — KR-29, §7.3. Lo juzga el SERVIDOR
   *  contra `items`/`manifiestos` (`servidor/paradas.ts::candadoDeLaParadaEn`, la misma lectura
   *  que sirve el snapshot del cliente): acá solo se recibe el veredicto.
   *
   *  Opcional, y ausente NO es «sin confirmar»: la subida del binario de una evidencia
   *  (`registrarBinarioDeEvidencia`) no vuelve a juzgar el candado —ya quedó dicho al aterrizar
   *  la captura, y repetirlo pondría dos filas en «Por revisar» por el mismo hecho (§9.3.1)— y
   *  una parada que no es de entrega no tiene candado que mirar. */
  manifiestoConfirmado?: boolean;
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

  // El reloj del SERVIDOR mide la ventana (§4.3), no el del aparato: es el único de los dos que
  // no se puede correr cambiando la hora del teléfono [AC-FPOD-07].
  const claseDeRevocacion = clasificarRevocacion(captura.revocadoEn, captura.recibidaEn);
  if (claseDeRevocacion === "post_revocacion" || claseDeRevocacion === "post_revocacion_tardia") {
    flags.push(claseDeRevocacion);
  }

  // El hueco de secuencia [AC-FPOD-10] — §4.7: evicción del outbox o manipulación, nunca
  // pérdida silenciosa. La captura aterriza igual (centinela 4: rechazos = 0).
  if (captura.secuenciaHueco) flags.push("secuencia_hueco");

  // El contrato de transporte del binario [AC-FPOD-19] — §4.6: sin promesa no hay mismatch (la
  // mayoría de las evidencias no llevan binario) y sin binario tampoco (el hash viaja ANTES, así
  // que hay un rato normal en que solo existe la promesa).
  if (
    captura.shaPrometido != null &&
    captura.shaRecalculado != null &&
    captura.shaPrometido.toLowerCase() !== captura.shaRecalculado.toLowerCase()
  ) {
    flags.push("sha256_mismatch");
  }

  // El candado del servidor [AC-FRUT-23] — KR-29, §7.3. `=== false` y no `!captura.manifiesto
  // Confirmado`: `undefined` es «acá no se juzga el candado» (la subida de un binario, una parada
  // que no es de entrega), y leerlo como «sin confirmar» llenaría «Por revisar» de severidad alta
  // desde el primer día — el mismo criterio con el que `moduloEncendido` trata la ausencia.
  if (captura.manifiestoConfirmado === false) flags.push("sin_manifiesto_confirmado");

  return flags;
}

/**
 * ¿La secuencia que trae esta captura deja un hueco respecto de la última que este dispositivo
 * dejó aterrizar [AC-FPOD-10]? `maximaAterrizada` es `null` cuando el dispositivo todavía no
 * tiene ninguna captura CON secuencia aterrizada: no hay contra qué comparar, así que la primera
 * nunca es un hueco — es la que fija el punto de partida. A partir de ahí, cualquier valor que no
 * sea exactamente el siguiente exacto deja un hueco (una repetición o un retroceso no lo son: eso
 * es el replay del mismo lote o un reloj de contador que no avanzó, y ya lo cubre la idempotencia
 * por `client_uuid` del §0 — este AC solo mira huecos hacia ADELANTE).
 */
export function esHuecoDeSecuencia(maximaAterrizada: number | null, secuencia: number): boolean {
  return maximaAterrizada !== null && secuencia > maximaAterrizada + 1;
}

/** La nueva `secuencia_maxima` del dispositivo después de aterrizar esta captura [AC-FPOD-10]:
 *  el mayor valor visto hasta ahora, exista o no hueco — un hueco no descarta lo que sí llegó. */
export function maximaConSecuencia(maximaAterrizada: number | null, secuencia: number): number {
  return maximaAterrizada === null ? secuencia : Math.max(maximaAterrizada, secuencia);
}

/**
 * ¿Esta bandera deja rastro —evento + fila en «Por revisar»— o se queda solo como flag visible
 * en el acuse? Todas menos `post_revocacion` [AC-FPOD-07, §4.3]: la que llega DENTRO de la
 * ventana de `REVOCACION.ventana_horas` se explica por falta de señal, y `revisionDe` (AC-FIDN-
 * 09) ya decidió que esa NO abre revisión — abrir una por cada aparato que pasó la noche sin
 * cobertura ahogaría la fila tardía, que es la que de verdad importa mirar.
 */
export function dejaRastro(flag: FlagDeCapturaPod): flag is Exclude<FlagDeCapturaPod, "post_revocacion"> {
  return flag !== "post_revocacion";
}

/**
 * Severidad de revisión por bandera. Todas entran con `SEVERIDAD_DE_CAPTURA_POD` salvo la
 * revocación tardía, que el §4.3 sube a `alta` — la misma severidad que decide `revisionDe`
 * (AC-FIDN-09): un aparato dado de baja que sigue sincronizando tres días después ya no se
 * explica por el terreno [AC-FPOD-07].
 */
export function severidadDeFlag(flag: FlagDeCapturaPod): string {
  if (flag === "post_revocacion_tardia") {
    return revisionDeRevocacion("post_revocacion_tardia")!.severidad;
  }
  // El POD sin manifiesto confirmado sube a `alta` [AC-FRUT-23] — KR-29, §7.3: las otras
  // degradaciones las explica el terreno (un teléfono con la hora corrida, un módulo que el dueño
  // apagó), y esta no: lo que falta es el ancla documental del art. 55 DL 825 sobre una entrega
  // que ya ocurrió. Mezclada en `media` con el resto se pierde entre el ruido de la bandeja.
  if (flag === "sin_manifiesto_confirmado") return SEVERIDAD_SIN_MANIFIESTO_CONFIRMADO;
  return SEVERIDAD_DE_CAPTURA_POD;
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

/** La severidad del POD que aterrizó sin el manifiesto de su carga confirmado [AC-FRUT-23] —
 *  KR-29, §7.3, §9.3.4. `alta`, la misma que la revocación tardía y por el mismo motivo: no la
 *  explica el terreno. */
export const SEVERIDAD_SIN_MANIFIESTO_CONFIRMADO = "alta";
