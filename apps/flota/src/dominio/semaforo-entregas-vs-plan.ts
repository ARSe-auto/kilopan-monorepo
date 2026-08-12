import type { ColorSemaforo, EstadoDominio, ExcepcionCruda } from "./semaforo.ts";
import type { UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Evaluación del dominio Entregas vs plan [AC-FSEM-19] — spec 05 §2.5 (Anexo B, fila
// `entregas_vs_plan`), partición de AC-FSEM-08 por §9.2, dependencia 03 (`paradas`:
// estado/resultado/`promesa_original`, spec 03 §4.5). Misma mecánica que los dominios hermanos
// (07/08/16-18): función PURA sobre hechos ya resueltos por quien la llame — el wiring contra
// `paradas` reales queda para un AC posterior, no exigido por el texto ni el oráculo de este AC
// (CI, no e2e).
//
// El Anexo B fija dos predicados para este dominio:
//
//   · % de no-entregas de la ruta — banda con histéresis, `no_entregas_pct_ruta` sembrada por la
//     migración 0059 (amarillo 5, rojo 10, recuperación 3). El texto del AC exige que el 10%
//     EXACTO se quede amarillo («no supera el rojo `>10%`») — a diferencia de `transicionColor`
//     (AC-FSEM-02), que dispara rojo con `>=`, acá el disparo a rojo es con `>` ESTRICTO, mismo
//     ajuste que `colorErroresSync` en AC-FSEM-11 para «errores de sync en 5% exacto ⇒ amarillo».
//   · compromiso vencido sin entrega ⇒ rojo, BINARIO — computado por el módulo dueño (03) a partir
//     de `promesa_original` CONGELADA (ventana vencida) y la parada sin entrega (`resultado` que
//     no es `exito`, §4.5). NO depende del ETA vivo: es la ventana que se le prometió al cliente,
//     no la proyección que se mueve todo el día.
//
// La señal amarilla del Anexo B «ETA proyectada + tolerancia (mín. 15 min) excede ventana
// comprometida» sigue CONDICIONADA a la pregunta 4 (spec 03: sin VRP en E1 el maestro no define
// cómo se computa un ETA) — NO se implementa acá; `HechosEntregasVsPlan` no trae ningún campo de
// ETA a propósito (test dedicado que lo confirma), mismo tratamiento que «liquidación observada»
// en AC-FSEM-17 y «backlog creciente 2 intervalos» en AC-FSEM-11.

/** % de no-entregas de una ruta [Anexo B, fila `entregas_vs_plan`, `no_entregas_pct_ruta`]. */
export type SenalNoEntregasRuta = {
  rutaId: string;
  quien: string;
  noEntregasPct: number;
  recordTime: Date;
};

/** Parada con compromiso vencido sin entrega [`paradas`, `promesa_original` CONGELADA vs ahora,
 *  spec 03 §4.5]: la ventana prometida ya pasó y la parada no se resolvió con `exito`. Binaria y
 *  siempre rojo — a diferencia del % de no-entregas, no hay banda amarilla que la module. */
export type ParadaCompromisoVencidoSinEntrega = {
  paradaId: string;
  quien: string;
  cuanto: string;
  recordTime: Date;
};

export type HechosEntregasVsPlan = {
  /** Umbrales de la fila `signal_rule` sembrada `no_entregas_pct_ruta` (migración 0059). */
  umbrales: UmbralesHisteresis;
  /** Color previo de la señal de % no-entregas por ruta, para la histéresis (§2.4) — «verde» en
   *  la primera evaluación de una ruta, sin alarma previa que sostener. */
  colorPrevioPorRuta: Readonly<Record<string, ColorSemaforo>>;
  rutas: SenalNoEntregasRuta[];
  comprometidoVencidoSinEntrega: ParadaCompromisoVencidoSinEntrega[];
  /** Denominador del agregado verde «N/M»: rutas evaluadas en el día. */
  totalRutas: number;
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

/**
 * Convención ASCENDENTE (mayor % = peor), igual que `transicionColor` (AC-FSEM-02), pero con
 * disparo a rojo ESTRICTO (`>`, no `>=`): el 10% exacto cae en la banda amarilla del Anexo B
 * («5–10% no-entregas»), no en el rojo («>10% no-entregas») — mismo ajuste que `colorErroresSync`
 * (AC-FSEM-11) sobre `transicionColor`.
 */
function colorNoEntregasPct(colorPrevio: ColorSemaforo, pct: number, umbrales: UmbralesHisteresis): ColorSemaforo {
  const { umbral_amarillo, umbral_rojo, umbral_recuperacion } = umbrales;
  if (pct > umbral_rojo) return "rojo";
  if (pct >= umbral_amarillo) return "amarillo";
  if (pct <= umbral_recuperacion) return "verde";
  return colorPrevio === "rojo" ? "amarillo" : colorPrevio;
}

const PLAYBOOK_NO_ENTREGAS =
  "Llamar al conductor de la ruta y confirmar el motivo de las no-entregas antes de cerrar el turno.";

/**
 * Evalúa el dominio Entregas vs plan [AC-FSEM-19] — spec 05 §2.5, Anexo B: combina el % de
 * no-entregas por ruta (con histéresis, disparo a rojo estricto) y el compromiso vencido sin
 * entrega (binario, siempre rojo) en las excepciones del dominio y el color de la tarjeta «Hoy»
 * (el peor de todas).
 */
export function evaluarEntregasVsPlan(hechos: HechosEntregasVsPlan): EstadoDominio {
  const excepciones: ExcepcionCruda[] = [];
  let peor: ColorSemaforo = "verde";

  for (const r of hechos.rutas) {
    const colorPrevio = hechos.colorPrevioPorRuta[r.rutaId] ?? "verde";
    const color = colorNoEntregasPct(colorPrevio, r.noEntregasPct, hechos.umbrales);
    if (color === "verde") continue;
    peor = peorDeLosDos(peor, color);
    excepciones.push({
      id: `no-entregas-${r.rutaId}`,
      descripcion: `${r.noEntregasPct}% de no-entregas — ${r.quien}`,
      record_time: r.recordTime,
      quien: r.quien,
      que: "No-entregas sobre el plan",
      cuanto: `${r.noEntregasPct}% no-entregas`,
      playbook: PLAYBOOK_NO_ENTREGAS,
      severidad: color,
      estado: "nueva",
    });
  }

  for (const p of hechos.comprometidoVencidoSinEntrega) {
    peor = peorDeLosDos(peor, "rojo");
    excepciones.push({
      id: `compromiso-vencido-${p.paradaId}`,
      descripcion: `Compromiso vencido sin entrega — ${p.quien}`,
      record_time: p.recordTime,
      quien: p.quien,
      que: "Compromiso vencido sin entrega",
      cuanto: p.cuanto,
      playbook: "Llamar al cliente, explicar la demora y reprogramar la entrega cuanto antes.",
      severidad: "rojo",
      estado: "nueva",
    });
  }

  const numerador = Math.max(0, hechos.totalRutas - excepciones.length);
  return {
    clave: "entregas_vs_plan",
    color: peor,
    agregado: { numerador, denominador: hechos.totalRutas },
    excepciones,
  };
}
