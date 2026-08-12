import type { ColorSemaforo, EstadoDominio, ExcepcionCruda } from "./semaforo.ts";
import { transicionColor, type UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Evaluación del dominio Turnos/conductores [AC-FSEM-08] — spec 05 §2.5 (Anexo B, fila
// `turnos_conductores`), dependencia 02: proyecciones append-only de `eventos` + `turnos` +
// `bloques_agenda`, jamás contadores mutables (§2, §4.6). Misma mecánica que AC-FSEM-07: una
// señal con histéresis (minutos sin evento del turno, `sin_senal_minutos` sembrado por la
// migración 0059: amarillo 30, rojo 120, recuperación 15) y dos condiciones binarias del Anexo
// B que ya llegan resueltas como hecho — este AC no las calcula del calendario, solo las
// proyecta a color, igual que `paradasSinEvidencia` en el dominio hermano.
//
// Wiring del endpoint real (`/api/semaforo/digest` contra `eventos`/`turnos`/`bloques_agenda`
// reales) queda para un AC posterior, mismo criterio que AC-FSEM-07: no está en el texto de
// este AC ni su oráculo lo exige (CI, no e2e).

/** Minutos sin evento de un turno [`eventos` + `turnos`, Anexo B «sin eventos 30–45 min en
 *  turno» / «sin señal >2 h»]. Un turno CERRADO no evalúa (misma qualifier «…en turno» que
 *  AC-FSEM-07 aplica a la cola de outbox): un turno que ya terminó no es una excepción. */
export type SenalSinEventoDeTurno = {
  turnoId: string;
  quien: string;
  minutosSinEvento: number;
  turnoAbierto: boolean;
  recordTime: Date;
};

/** Un turno todavía abierto más de 1 h después del fin de su bloque agendado [`turnos` ×
 *  `bloques_agenda`, Anexo B «turno sin cerrar >1 h tras fin del bloque»]. Binaria: su sola
 *  presencia en esta lista ya cruzó el umbral — este dominio no recalcula el fin de bloque. */
export type TurnoSinCerrarTrasBloque = {
  turnoId: string;
  quien: string;
  minutosTrasFinDeBloque: number;
  recordTime: Date;
};

/** Un turno abierto cuyo rango cruza medianoche [`turnos`, Anexo B «turno abierto cruzando
 *  medianoche»]. Binaria y siempre rojo — a diferencia de la señal de minutos sin evento, no
 *  hay banda amarilla que la module. */
export type TurnoCruzandoMedianoche = {
  turnoId: string;
  quien: string;
  recordTime: Date;
};

export type HechosTurnosConductores = {
  umbrales: UmbralesHisteresis;
  /** Color previo de la señal de minutos sin evento, para la histéresis (§2.4) — «verde» en la
   *  primera evaluación de un turno, sin alarma previa que sostener. */
  colorPrevioSinEvento: ColorSemaforo;
  sinEvento: SenalSinEventoDeTurno[];
  sinCerrarTrasBloque: TurnoSinCerrarTrasBloque[];
  cruzandoMedianoche: TurnoCruzandoMedianoche[];
  totalTurnos: number;
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

/**
 * Evalúa el dominio Turnos/conductores [AC-FSEM-08] — spec 05 §2.5, Anexo B: combina la señal
 * de minutos sin evento (con histéresis) y las dos condiciones binarias en las excepciones del
 * dominio y el color de la tarjeta «Hoy» (el peor de todas).
 */
export function evaluarTurnosConductores(hechos: HechosTurnosConductores): EstadoDominio {
  const excepciones: ExcepcionCruda[] = [];
  let peor: ColorSemaforo = "verde";

  for (const t of hechos.sinEvento) {
    if (!t.turnoAbierto) continue;
    const color = transicionColor(hechos.colorPrevioSinEvento, t.minutosSinEvento, hechos.umbrales);
    if (color === "verde") continue;
    peor = peorDeLosDos(peor, color);
    excepciones.push({
      id: `sin-evento-${t.turnoId}`,
      descripcion: `Turno sin eventos hace ${t.minutosSinEvento} min — ${t.quien}`,
      record_time: t.recordTime,
      quien: t.quien,
      que: "Turno sin eventos",
      cuanto: `${t.minutosSinEvento} min sin señal`,
      playbook: "Llamar al conductor: sin eventos desde hace rato, confirmar que el turno sigue en curso.",
      severidad: color,
      estado: "nueva",
    });
  }

  for (const t of hechos.sinCerrarTrasBloque) {
    peor = peorDeLosDos(peor, "amarillo");
    excepciones.push({
      id: `sin-cerrar-${t.turnoId}`,
      descripcion: `Turno sin cerrar ${t.minutosTrasFinDeBloque} min tras fin de bloque — ${t.quien}`,
      record_time: t.recordTime,
      quien: t.quien,
      que: "Turno sin cerrar tras fin de bloque",
      cuanto: `${t.minutosTrasFinDeBloque} min tras el fin del bloque`,
      playbook: "Confirmar con el conductor si el turno terminó y cerrarlo, o extender el bloque agendado.",
      severidad: "amarillo",
      estado: "nueva",
    });
  }

  for (const t of hechos.cruzandoMedianoche) {
    peor = peorDeLosDos(peor, "rojo");
    excepciones.push({
      id: `medianoche-${t.turnoId}`,
      descripcion: `Turno abierto cruzando medianoche — ${t.quien}`,
      record_time: t.recordTime,
      quien: t.quien,
      que: "Turno abierto cruzando medianoche",
      cuanto: "cruzó medianoche sin cerrar",
      playbook: "Cerrar el turno o confirmar con el conductor si sigue activo tras medianoche.",
      severidad: "rojo",
      estado: "nueva",
    });
  }

  const numerador = Math.max(0, hechos.totalTurnos - excepciones.length);
  return {
    clave: "turnos_conductores",
    color: peor,
    agregado: { numerador, denominador: hechos.totalTurnos },
    excepciones,
  };
}
