import type { ColorSemaforo, EstadoDominio, ExcepcionCruda } from "./semaforo.ts";
import { transicionColor, type UmbralesHisteresis } from "./semaforo-histeresis.ts";

// Evaluación del dominio DaaS/SLA [AC-FSEM-18] — spec 05 §2.5 (Anexo B, fila `daas_sla`),
// partición de AC-FSEM-08 por §9.2, dependencia 06 (`otd_comprometido_pct` del contrato, que
// en su ausencia contrae el dominio, §5.5) y 03 (`paradas` cerradas vs ventana). Solo evalúa
// en modo `daas` (§3.E1.11) — el orquestador de Nivel 0 ya decide, por AC-FSEM-01, que la
// tarjeta SLA no existe sin al menos una empresa con `otd_comprometido_pct` NOT NULL; esta
// función es la mitad que ESE orquestador consultaría por empresa, mismo criterio que
// AC-FSEM-07/08/11/16/17: pura sobre hechos ya resueltos, sin wiring contra `paradas`/
// `liquidacion` reales todavía (queda para un AC posterior, no exigido por el texto ni el
// oráculo de este AC — CI, no e2e).
//
// El Anexo B fija dos predicados sobre UNA sola métrica, `otd_deficit_pp` (déficit del OTD
// contra el comprometido, en puntos porcentuales — sembrada por la migración 0059: amarillo 2,
// rojo 5, recuperación 0), convención ASCENDENTE (mayor déficit = peor):
//
//   · amarillo — OTD PROYECTADO (período todavía abierto) bajo el comprometido en ≥2 pp: aviso
//     temprano mientras el período corre.
//   · rojo     — SLA INCUMPLIDO EN EL PERÍODO: con el período ya CERRADO, el déficit real
//     (`paradas` cerradas vs ventana × `otd_comprometido_pct`, §4.5) alcanza el umbral_rojo — el
//     fixture del AC (comprometido 95, período cerrado 90) da déficit 5, el mismo número que fija
//     la migración 0059 para no inventar un segundo valor que este AC tendría que reconciliar.
//
// Una y otra son la MISMA métrica en dos momentos del ciclo (proyección mientras el período
// corre, cierre real al terminar) — por eso pasan por la histéresis única de `transicionColor`,
// igual que `outbox_edad_max` en AC-FSEM-07 combina fuentes vivas bajo un solo umbral.
//
// «Empresa con `otd_comprometido_pct` NULL ⇒ su `signal_rule` no evalúa y sin tarjeta SLA para
// esa empresa» (§4.5): esta función NO produce excepción ni cuenta esa empresa en el
// denominador — el precedente SLA-NULL ya vive a nivel de Nivel 0 (AC-FSEM-01) para la tarjeta
// completa; acá se repite por-empresa porque el dominio DaaS puede tener varias empresas
// clientes con contratos distintos en el mismo tenant.

/** Señal de OTD de una empresa cliente con contrato DaaS [Anexo B, fila `daas_sla`].
 *  `otdComprometidoPct` en NULL significa que esta empresa NO tiene SLA pactado: no evalúa
 *  (§4.5) — mismo precedente que decide si la tarjeta SLA existe en Nivel 0 (AC-FSEM-01). */
export type SenalOtdEmpresa = {
  empresaId: string;
  empresaNombre: string;
  otdComprometidoPct: number | null;
  /** Proyección del OTD del período EN CURSO — la fuente del aviso amarillo temprano. */
  otdProyectadoPct: number;
  /** OTD real del período YA CERRADO (`paradas` cerradas vs ventana, §4.5) — null mientras el
   *  período sigue abierto; cuando existe, es la fuente autoritativa del rojo «incumplido». */
  otdPeriodoCerradoPct: number | null;
  recordTime: Date;
};

export type HechosDaasSla = {
  /** Umbrales de la fila `signal_rule` sembrada `otd_deficit_pp` (migración 0059). */
  umbrales: UmbralesHisteresis;
  /** Color previo de la señal de déficit por empresa, para la histéresis (§2.4) — «verde» en
   *  la primera evaluación de una empresa, sin alarma previa que sostener. */
  colorPrevioPorEmpresa: Readonly<Record<string, ColorSemaforo>>;
  empresas: SenalOtdEmpresa[];
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

const PLAYBOOK_SLA =
  "Revisar el contrato con OTD bajo el comprometido y coordinar con el cliente antes del cierre del período.";

/**
 * Evalúa el dominio DaaS/SLA [AC-FSEM-18] — spec 05 §2.5, Anexo B: combina el déficit de OTD
 * por empresa (con histéresis, proyectado o de período cerrado según lo que haya) en las
 * excepciones del dominio y el color de la tarjeta «Hoy» (el peor de todas). Las empresas sin
 * `otd_comprometido_pct` (NULL) se saltan por completo: ni excepción, ni denominador.
 */
export function evaluarDaasSla(hechos: HechosDaasSla): EstadoDominio {
  const excepciones: ExcepcionCruda[] = [];
  let peor: ColorSemaforo = "verde";
  let totalEmpresasConSla = 0;

  for (const e of hechos.empresas) {
    if (e.otdComprometidoPct === null) continue;
    totalEmpresasConSla += 1;

    const periodoCerrado = e.otdPeriodoCerradoPct !== null;
    const otdVigente = periodoCerrado ? e.otdPeriodoCerradoPct! : e.otdProyectadoPct;
    const deficit = e.otdComprometidoPct - otdVigente;
    const colorPrevio = hechos.colorPrevioPorEmpresa[e.empresaId] ?? "verde";
    const color = transicionColor(colorPrevio, deficit, hechos.umbrales);
    if (color === "verde") continue;

    peor = peorDeLosDos(peor, color);
    const que = periodoCerrado ? "SLA incumplido en el período" : "OTD proyectado bajo el comprometido";
    excepciones.push({
      id: `otd-deficit-${e.empresaId}`,
      descripcion: `${que} — ${e.empresaNombre} (OTD ${otdVigente}% contra ${e.otdComprometidoPct}% comprometido)`,
      record_time: e.recordTime,
      quien: e.empresaNombre,
      que,
      cuanto: `déficit ${deficit.toFixed(1)} pp`,
      playbook: PLAYBOOK_SLA,
      severidad: color,
      estado: "nueva",
    });
  }

  const numerador = Math.max(0, totalEmpresasConSla - excepciones.length);
  return {
    clave: "daas_sla",
    color: peor,
    agregado: { numerador, denominador: totalEmpresasConSla },
    excepciones,
  };
}
