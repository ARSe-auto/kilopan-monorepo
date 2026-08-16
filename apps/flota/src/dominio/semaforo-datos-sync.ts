import type { ColorSemaforo, EstadoDominio, ExcepcionCruda } from "./semaforo.ts";
import { transicionColor, type UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Evaluación del dominio Datos/sync [AC-FSEM-07] — spec 05 §2.4/§2.5, Anexo B, dependencia 04.
//
// Tres familias de hechos, las tres YA existen sin migración nueva (el módulo 04 las escribe
// hoy, migración 0002): la edad del outbox de cada dispositivo (`client_metric` tipo
// `outbox_edad_max`), las paradas `done` sin fila en `evidence` tras su sync (join
// `paradas`×`evidence`) y las filas de `review_queue` que `servidor/capturas.ts::
// dejarDichoQueDegrado` ya escribe por cada flag de captura degradada (AC-FPOD-05/07/10) — este
// AC no agrega una fila nueva a esas tablas, solo las PROYECTA a color, que es lo que le faltaba
// al Nivel 0 (comentario de AC-FSEM-06: «la evaluación real de signal_rule es AC-FSEM-07+»).
//
// La edad del outbox (`pendientes >30–60 min` / `sin sync >3–4 h`, Anexo B) es UNA métrica con
// histéresis (§2.4): más vieja la cola, peor el color, por eso pasa por `transicionColor` con los
// umbrales de la fila `signal_rule` sembrada (`outbox_cola_edad_max_min`, migración 0059). Las
// otras dos —«entrega sin evidencia tras sync» y «hueco de secuencia»— son binarias en el Anexo
// B: su sola presencia es rojo, sin banda amarilla que las module.
//
// La severidad→color del §2.4 («este módulo exige poder proyectar esa escala a {amarillo, rojo}
// sin ambigüedad») es la regla GENÉRICA para cualquier fila de `review_queue` que caiga en este
// dominio; el hueco de secuencia es la EXCEPCIÓN documentada a esa regla, no un descuido: su
// severidad de captura es `media` (`SEVERIDAD_DE_CAPTURA_POD`, `dominio/pod-sync.ts`, AC-FPOD-10)
// porque así entra parejo a la bandeja de revisión con el resto de las degradaciones de POD, pero
// el Anexo B lo clasifica ROJO en la tarjeta del semáforo igual — dos escalas con dueños
// distintos: `review_queue.severidad` es del triage general, el color del semáforo es de este
// módulo. La revocación tardía SÍ sigue la proyección genérica (su severidad ya es `alta`, así
// que el resultado coincide).

/** Edad de la cola de outbox de un dispositivo [`client_metric`, tipo `outbox_edad_max`]. Un
 *  dispositivo con turno cerrado no evalúa (Anexo B: «…en turno», «…con turno abierto») — la
 *  cola de un aparato que ya volvió a la base no es una excepción, es lo esperable. */
export type OutboxDeDispositivo = {
  dispositivoId: string;
  quien: string;
  edadMaxMin: number;
  turnoAbierto: boolean;
  recordTime: Date;
};

/** Una parada `done` cuyo sync no trajo ninguna fila en `evidence` [join paradas×evidence,
 *  Anexo B «entrega sin evidencia tras sync»]. */
export type ParadaSinEvidenciaTrasSync = {
  paradaId: string;
  quien: string;
  recordTime: Date;
};

/** Una fila de `review_queue` cuyo origen pertenece a este dominio — hoy exactamente las dos que
 *  `servidor/capturas.ts` escribe al aterrizar una captura degradada de POD (§4.7, §4.3): el
 *  hueco de secuencia y la revocación tardía. Es la captura que entró 2xx (jamás rebotó, §4.2)
 *  proyectada acá como EXCEPCIÓN del dominio — no hay un camino aparte de «error del
 *  dispositivo»: si está en `review_queue` con uno de estos orígenes, es una fila más de «Por
 *  revisar» que esta función traduce a color, igual que cualquier otra. */
export type ExcepcionReviewQueueDatosSync = {
  id: string;
  origen: "entrega.secuencia_hueco" | "entrega.post_revocacion_tardia";
  severidad: string;
  estado: "nueva" | "reconocida";
  quien: string;
  recordTime: Date;
};

export type HechosDatosSync = {
  umbrales: UmbralesHisteresis;
  /** Color previo de la señal de outbox, para la histéresis (§2.4) — «verde» en la primera
   *  evaluación de un dispositivo, sin alarma previa que sostener. */
  colorPrevioOutbox: ColorSemaforo;
  outbox: OutboxDeDispositivo[];
  paradasSinEvidencia: ParadaSinEvidenciaTrasSync[];
  excepcionesReviewQueue: ExcepcionReviewQueueDatosSync[];
  totalDispositivos: number;
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

/**
 * Proyección severidad→color del §2.4, genérica para cualquier fila de `review_queue`: `alta` es
 * rojo, cualquier otra (`media` hoy, la única que existe) es amarillo. Sin default a verde — una
 * fila en «Por revisar» nunca es verde, sea cual sea su severidad.
 */
export function colorDeSeveridad(severidad: string): "amarillo" | "rojo" {
  return severidad === "alta" ? "rojo" : "amarillo";
}

/**
 * El color de una excepción de `review_queue` de este dominio. El hueco de secuencia es la
 * excepción documentada a la proyección genérica de arriba (ver comentario de cabecera): el
 * Anexo B lo clasifica rojo aunque su severidad de captura sea `media`.
 */
function colorDeExcepcionReviewQueue(exc: ExcepcionReviewQueueDatosSync): "amarillo" | "rojo" {
  if (exc.origen === "entrega.secuencia_hueco") return "rojo";
  return colorDeSeveridad(exc.severidad);
}

function descripcionDeOrigen(origen: ExcepcionReviewQueueDatosSync["origen"], quien: string): string {
  return origen === "entrega.secuencia_hueco"
    ? `Hueco de secuencia detectado — ${quien}`
    : `Captura de un aparato revocado hace más de la ventana de cuarentena — ${quien}`;
}

function playbookDeOrigen(origen: ExcepcionReviewQueueDatosSync["origen"]): string {
  return origen === "entrega.secuencia_hueco"
    ? "Revisar el registro de sync del dispositivo y forzar reenvío."
    : "Confirmar con el conductor si el aparato sigue en uso y reasignar credenciales si corresponde.";
}

/**
 * Evalúa el dominio Datos/sync [AC-FSEM-07] — spec 05 §2.4, Anexo B: combina las tres familias
 * de hechos en las excepciones del dominio y el color de la tarjeta «Hoy» (el peor de todas).
 */
export function evaluarDatosSync(hechos: HechosDatosSync): EstadoDominio {
  const excepciones: ExcepcionCruda[] = [];
  let peor: ColorSemaforo = "verde";

  for (const d of hechos.outbox) {
    if (!d.turnoAbierto) continue;
    const color = transicionColor(hechos.colorPrevioOutbox, d.edadMaxMin, hechos.umbrales);
    if (color === "verde") continue;
    peor = peorDeLosDos(peor, color);
    excepciones.push({
      id: `outbox-${d.dispositivoId}`,
      descripcion: `Cola de sync sin vaciar hace ${d.edadMaxMin} min — ${d.quien}`,
      record_time: d.recordTime,
      quien: d.quien,
      que: "Cola de sync sin vaciar",
      cuanto: `${d.edadMaxMin} min sin sincronizar`,
      playbook: "Revisar el dispositivo con la cola de sync más vieja y pedirle sincronizar cuanto antes.",
      severidad: color,
      estado: "nueva",
    });
  }

  for (const p of hechos.paradasSinEvidencia) {
    peor = peorDeLosDos(peor, "rojo");
    excepciones.push({
      id: `evidencia-${p.paradaId}`,
      descripcion: `Entrega sin evidencia tras sync — parada ${p.paradaId}`,
      record_time: p.recordTime,
      quien: p.quien,
      que: "Entrega sin evidencia tras sync",
      cuanto: "sin evidencia",
      playbook: "Revisar la parada y solicitar la evidencia al conductor.",
      severidad: "rojo",
      estado: "nueva",
    });
  }

  for (const exc of hechos.excepcionesReviewQueue) {
    const color = colorDeExcepcionReviewQueue(exc);
    peor = peorDeLosDos(peor, color);
    excepciones.push({
      id: exc.id,
      descripcion: descripcionDeOrigen(exc.origen, exc.quien),
      record_time: exc.recordTime,
      quien: exc.quien,
      que: descripcionDeOrigen(exc.origen, exc.quien),
      cuanto: `severidad ${exc.severidad}`,
      playbook: playbookDeOrigen(exc.origen),
      severidad: color,
      estado: exc.estado,
    });
  }

  const numerador = Math.max(0, hechos.totalDispositivos - excepciones.length);
  return {
    clave: "datos_sync",
    color: peor,
    agregado: { numerador, denominador: hechos.totalDispositivos },
    excepciones,
  };
}
