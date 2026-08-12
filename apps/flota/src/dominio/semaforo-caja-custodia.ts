import type { ColorSemaforo, EstadoDominio, ExcepcionCruda } from "./semaforo.ts";

// Evaluación del dominio Caja/custodia/liquidación [AC-FSEM-17] — spec 05 §2.5 (Anexo B, fila
// `caja_custodia_liquidacion`), partición de AC-FSEM-08 por §9.2, dependencias 03 (cadena de
// custodia, `cierres_ruta`/`devoluciones`) y 06 (liquidación, `liquidacion_lineas`) — ninguno de
// los dos módulos tiene su AC de esquema construido todavía (AC-FRUT-11/21 sí; los AC-FTAR-*
// siguen `[ ]`), mismo criterio que AC-FSEM-07/08/11/16: esta función es PURA sobre hechos ya
// resueltos por quien la llame; el wiring contra `cierres_ruta`/`liquidacion_lineas` reales
// queda para un AC posterior — no está en el texto de este AC ni su oráculo lo exige (CI, no
// e2e).
//
// El Anexo B fija cuatro predicados para este dominio:
//
//   · amarillo — discrepancia de custodia pendiente (spec 03 §4: sub-manifiesto F2, «discrepancia
//     registrada EN el punto»)
//   · amarillo — liquidación «observada» — CONDICIONADA a la pregunta 11 de esta spec (canónica en
//     spec 06, pregunta 6): §3.E1.9 solo define `abierta→cerrada→pagada` + disputa por línea, y
//     ningún estado del maestro se llama «observada». NO se implementa acá — `HechosCajaCustodia
//     Liquidacion` no trae ningún campo de esa semántica a propósito (test dedicado que lo
//     confirma), mismo tratamiento que «backlog creciente 2 intervalos» en AC-FSEM-11.
//   · rojo     — descuadre confirmado sin evidencia (spec 03 §4: cierre que llega descuadrado por
//     sync sin fila de `devoluciones` que respalde el faltante declarado)
//   · rojo     — línea disputada («dinero disputado siempre es rojo», Anexo B; spec 06: «cada
//     disputa... alimenta la señal roja de Caja/custodia»); NO tiene banda amarilla
//
// Las tres implementadas son BINARIAS: un hecho ya resuelto por el módulo dueño (03 o 06), sin
// histéresis — mismo criterio que «turno cruzando medianoche» en AC-FSEM-08 y las binarias de
// AC-FSEM-16.
//
// «Con liquidación OFF esas señales no evalúan» (§5.5) es la gatilla GENÉRICA de
// `dominioSemaforoActivo` (`dominio/semaforo.ts`, AC-FSEM-13) sobre
// `FEATURE_QUE_CONTRAE_DOMINIO.caja_custodia_liquidacion = "liquidacion_por_cliente"` — ya
// probada específicamente para este dominio en `semaforo.test.ts`; el orquestador llama a
// `dominioSemaforoActivo` ANTES de invocar este evaluador, jamás al revés, así que esta función
// no repite esa gatilla.

/** Discrepancia de custodia registrada sin resolver [spec 03 §4, sub-manifiesto F2]. */
export type DiscrepanciaCustodiaPendiente = {
  id: string;
  quien: string;
  cuanto: string;
  recordTime: Date;
};

/** Cierre de ruta que llegó descuadrado por sync sin fila de `devoluciones` que respalde el
 *  faltante declarado [spec 03 §4]. Un descuadre con su devolución materializada YA cuadra la
 *  ecuación (AC-FRUT-11/21) y no entra a esta lista. */
export type CierreDescuadradoSinEvidencia = {
  id: string;
  quien: string;
  cuanto: string;
  recordTime: Date;
};

/** Línea de liquidación en estado disputado [spec 06 §"Cada disputa..."]. Dinero disputado
 *  siempre es rojo — no hay grado intermedio que evaluar. */
export type LineaDisputada = {
  id: string;
  quien: string;
  cuanto: string;
  recordTime: Date;
};

export type HechosCajaCustodiaLiquidacion = {
  discrepanciasPendientes: DiscrepanciaCustodiaPendiente[];
  cierresDescuadradosSinEvidencia: CierreDescuadradoSinEvidencia[];
  lineasDisputadas: LineaDisputada[];
  /** Denominador del agregado verde «N/M»: cierres + liquidaciones evaluadas en el período. */
  totalOperaciones: number;
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

/**
 * Evalúa el dominio Caja/custodia/liquidación [AC-FSEM-17] — spec 05 §2.5, Anexo B: combina las
 * tres señales binarias implementadas en las excepciones del dominio y el color de la tarjeta
 * «Hoy» (el peor de todas).
 */
export function evaluarCajaCustodiaLiquidacion(hechos: HechosCajaCustodiaLiquidacion): EstadoDominio {
  const excepciones: ExcepcionCruda[] = [];
  let peor: ColorSemaforo = "verde";

  for (const d of hechos.discrepanciasPendientes) {
    peor = peorDeLosDos(peor, "amarillo");
    excepciones.push({
      id: `discrepancia-${d.id}`,
      descripcion: `Discrepancia de custodia pendiente — ${d.quien}`,
      record_time: d.recordTime,
      quien: d.quien,
      que: "Discrepancia de custodia pendiente",
      cuanto: d.cuanto,
      playbook: "Revisar el sub-manifiesto en el punto y resolver la discrepancia con la empresa correspondiente.",
      severidad: "amarillo",
      estado: "nueva",
    });
  }

  for (const c of hechos.cierresDescuadradosSinEvidencia) {
    peor = peorDeLosDos(peor, "rojo");
    excepciones.push({
      id: `descuadre-${c.id}`,
      descripcion: `Descuadre de cierre sin evidencia de respaldo — ${c.quien}`,
      record_time: c.recordTime,
      quien: c.quien,
      que: "Descuadre sin evidencia",
      cuanto: c.cuanto,
      playbook: "Confirmar con el chofer el destino del faltante y registrar la devolución que lo respalde.",
      severidad: "rojo",
      estado: "nueva",
    });
  }

  for (const l of hechos.lineasDisputadas) {
    peor = peorDeLosDos(peor, "rojo");
    excepciones.push({
      id: `disputa-${l.id}`,
      descripcion: `Línea de liquidación disputada — ${l.quien}`,
      record_time: l.recordTime,
      quien: l.quien,
      que: "Línea disputada",
      cuanto: l.cuanto,
      playbook: "Revisar el motivo de la disputa con la empresa cliente y resolverla dentro de la ventana de 7 días.",
      severidad: "rojo",
      estado: "nueva",
    });
  }

  const numerador = Math.max(0, hechos.totalOperaciones - excepciones.length);
  return {
    clave: "caja_custodia_liquidacion",
    color: peor,
    agregado: { numerador, denominador: hechos.totalOperaciones },
    excepciones,
  };
}
