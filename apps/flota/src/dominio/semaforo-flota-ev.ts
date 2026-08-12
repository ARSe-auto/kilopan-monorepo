import type { ColorSemaforo, EstadoDominio, ExcepcionCruda } from "./semaforo.ts";
import { transicionColor, type UmbralesHisteresis } from "./semaforo-histeresis.ts";
import {
  consumoDelTramoPct,
  socProyectadoPct,
  sinEnchufar,
  RETORNO_MINIMO_PCT,
  type MetodoDeEstimacion,
  type Tramo,
} from "../../../../packages/nucleo-comun/src/senales-ev.ts";
import { reservaPctDe } from "../../../../packages/nucleo-comun/src/energia.ts";

// Evaluación del dominio Flota/energía EV [AC-FSEM-16] — spec 05 §2.5 (Anexo B, fila
// `flota_energia_ev`), partición de AC-FSEM-08 por §9.2, dependencia 02: consume las
// PROYECCIONES del módulo EV (`socProyectadoPct`/`consumoDelTramoPct`/`sinEnchufar`, todas de
// `packages/nucleo-comun/src/senales-ev.ts`, AC-FVEH-11) sobre la fórmula única del §0 — este
// archivo no re-especifica un solo número ni una sola resta de la familia de energía, solo
// ORQUESTA lo que el módulo 02 ya entrega, igual que `dominio/tablero.ts` orquesta el semáforo
// del chofer con las mismas funciones (§1: «este módulo solo consume sus proyecciones»).
//
// El Anexo B fija cuatro predicados para este dominio, en el orden exacto de severidad:
//
//   · rojo     — SOC actual < consumo estimado del tramo restante (el tramo no se completa)
//   · rojo     — retorno proyectado <15 % (constante fija del Anexo B, `RETORNO_MINIMO_PCT`)
//   · amarillo — SOC proyectado al fin del bloque < reserva + 5 pp
//   · rojo     — «no quedó enchufado» a la hora límite (directo de `enchufadoConfirmado`)
//
// Los dos primeros son BINARIOS —un hecho ya resuelto por el módulo 02, sin banda amarilla que
// los module—, mismo criterio que «turno cruzando medianoche» en AC-FSEM-08: se proyectan a
// rojo directo, sin histéresis. El tercero SÍ tiene histéresis (§2.4): la fila `signal_rule`
// sembrada por la migración 0059 (`soc_margen_reserva_pp`, amarillo 5 / rojo 0 / recuperación
// 10) gobierna la transición sobre el MARGEN de SOC proyectado sobre la reserva del tenant
// (`proyectado - reserva`) — convención DESCENDENTE de `transicionColor` (a menor margen, peor
// color; el signo se invierte antes de llamar, como pide su propio comentario). Que ese margen
// pueda tocar cero y escalar a rojo por sí solo —sin pasar por el retorno mínimo fijo del 15 %—
// es intencional: un tenant con `reserva_pct` alto (§4.4) exige más margen que el piso parejo
// del Anexo B, y la histéresis lo sostiene sin que el 15 % fijo lo tape.
//
// Wiring del endpoint real (`/api/semaforo/digest` contra `turnos`/`reading`/`energy_entry`
// reales) queda para un AC posterior, mismo criterio que AC-FSEM-07/08/11: no está en el texto
// de este AC ni su oráculo lo exige (CI, no e2e).

/** Un tramo evaluable de un vehículo con turno abierto — mismo shape que exige `senales-ev.ts`
 *  (AC-FVEH-11): `datos`/`parametros` ya trae lo que el trigger de `vehiculos` proyecta y lo
 *  que el tenant ajustó en `parametros` (§4.4). El método es explícito porque la pregunta 13 de
 *  la spec 02 sigue abierta — ningún default escondido. */
export type SenalTramoVehiculo = {
  vehiculoId: string;
  quien: string;
  tramo: Tramo;
  metodo: MetodoDeEstimacion;
  recordTime: Date;
};

/** «No quedó enchufado» a la hora límite [`turnos.enchufado_confirmado`, Anexo B]. La hora
 *  límite llega YA resuelta (pregunta 5c/8 de la spec 02): este dominio no la calcula. */
export type SenalEnchufado = {
  vehiculoId: string;
  quien: string;
  turno: { enchufadoConfirmado: boolean | null; cerradoEn: Date | null };
  horaLimite: Date;
  ahora: Date;
  recordTime: Date;
};

export type HechosFlotaEv = {
  /** Umbrales de la fila `signal_rule` sembrada `soc_margen_reserva_pp` (migración 0059). */
  umbralesMargen: UmbralesHisteresis;
  /** Color previo de la señal de margen, para la histéresis (§2.4) — «verde» en la primera
   *  evaluación de un vehículo, sin alarma previa que sostener. */
  colorPrevioMargen: ColorSemaforo;
  tramos: SenalTramoVehiculo[];
  enchufados: SenalEnchufado[];
  totalVehiculos: number;
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

const PLAYBOOK_ENERGIA =
  "Revisar el vehículo con margen de batería bajo la reserva y coordinar carga antes del próximo tramo.";

/**
 * Evalúa el dominio Flota/energía EV [AC-FSEM-16] — spec 05 §2.5, Anexo B: combina las
 * proyecciones del módulo 02 en las excepciones del dominio y el color de la tarjeta «Hoy» (el
 * peor de todas).
 */
export function evaluarFlotaEv(hechos: HechosFlotaEv): EstadoDominio {
  const excepciones: ExcepcionCruda[] = [];
  let peor: ColorSemaforo = "verde";

  for (const t of hechos.tramos) {
    const proyectado = socProyectadoPct(t.tramo, t.metodo);
    // Sin ficha EV completa no hay proyección que afirmar (AC-FVEH-09/11): ni rojo ni amarillo
    // inventados — el vehículo simplemente no entra a la cola de excepciones de este ciclo.
    if (proyectado === null) continue;

    const consumo = consumoDelTramoPct(t.tramo, t.metodo)!;
    if (t.tramo.socActualPct < consumo) {
      peor = peorDeLosDos(peor, "rojo");
      excepciones.push({
        id: `sin-alcance-${t.vehiculoId}`,
        descripcion: `SOC actual (${t.tramo.socActualPct}%) bajo el consumo estimado del tramo restante — ${t.quien}`,
        record_time: t.recordTime,
        quien: t.quien,
        que: "SOC insuficiente para el tramo restante",
        cuanto: `SOC actual ${t.tramo.socActualPct}%`,
        playbook: PLAYBOOK_ENERGIA,
        severidad: "rojo",
        estado: "nueva",
      });
      continue;
    }

    if (proyectado < RETORNO_MINIMO_PCT) {
      peor = peorDeLosDos(peor, "rojo");
      excepciones.push({
        id: `retorno-bajo-${t.vehiculoId}`,
        descripcion: `Retorno proyectado ${proyectado}% bajo el mínimo — ${t.quien}`,
        record_time: t.recordTime,
        quien: t.quien,
        que: "Retorno proyectado bajo el mínimo",
        cuanto: `${proyectado}% proyectado al retorno`,
        playbook: PLAYBOOK_ENERGIA,
        severidad: "rojo",
        estado: "nueva",
      });
      continue;
    }

    const reserva = reservaPctDe(t.tramo.parametros);
    const margen = proyectado - reserva;
    const umbralesAscendentes: UmbralesHisteresis = {
      umbral_amarillo: -hechos.umbralesMargen.umbral_amarillo,
      umbral_rojo: -hechos.umbralesMargen.umbral_rojo,
      umbral_recuperacion: -hechos.umbralesMargen.umbral_recuperacion,
    };
    const colorMargen = transicionColor(hechos.colorPrevioMargen, -margen, umbralesAscendentes);
    if (colorMargen === "verde") continue;
    peor = peorDeLosDos(peor, colorMargen);
    excepciones.push({
      id: `margen-reserva-${t.vehiculoId}`,
      descripcion: `SOC proyectado al fin del bloque a ${margen.toFixed(1)} pp de la reserva — ${t.quien}`,
      record_time: t.recordTime,
      quien: t.quien,
      que: "SOC proyectado cerca de la reserva",
      cuanto: `${margen.toFixed(1)} pp sobre la reserva`,
      playbook: PLAYBOOK_ENERGIA,
      severidad: colorMargen,
      estado: "nueva",
    });
  }

  for (const e of hechos.enchufados) {
    if (!sinEnchufar(e.turno, e.horaLimite, e.ahora)) continue;
    peor = peorDeLosDos(peor, "rojo");
    excepciones.push({
      id: `sin-enchufar-${e.vehiculoId}`,
      descripcion: `No quedó enchufado a la hora límite — ${e.quien}`,
      record_time: e.recordTime,
      quien: e.quien,
      que: "No quedó enchufado",
      cuanto: "sin confirmar enchufado a la hora límite",
      playbook: "Confirmar con el conductor si el vehículo quedó enchufado y coordinar la carga cuanto antes.",
      severidad: "rojo",
      estado: "nueva",
    });
  }

  const numerador = Math.max(0, hechos.totalVehiculos - excepciones.length);
  return {
    clave: "flota_energia_ev",
    color: peor,
    agregado: { numerador, denominador: hechos.totalVehiculos },
    excepciones,
  };
}
