import { EV, SOC } from "./constants.ts";
import { rangoEfectivoKm, reservaPctDe, type DatosEv, type ParametrosDeEnergia } from "./energia.ts";

// Los DATOS FUENTE de las señales Flota/EV, evaluables [AC-FVEH-11] — Anexo B, §5.6, §5.7.
//
// ─── QUÉ ES ESTE ARCHIVO Y QUÉ NO ───────────────────────────────────────────────────
//
// El Anexo B fija tres predicados para el dominio Flota/EV:
//
//   · amarillo — SOC proyectado al fin del bloque < reserva + 5 pp
//   · rojo     — SOC actual < consumo estimado del tramo restante
//   · rojo     — retorno proyectado <15 %
//   · rojo     — «no quedó enchufado» a la hora límite
//
// Acá están los PREDICADOS, puros y evaluables contra un fixture. Lo que NO está —y es del
// hito (e), §5.6/§9.1-4e— es el DDL de `signal_rule`, el motor de evaluación con histéresis y
// umbral de recuperación, la tarjeta «Flota/energía EV» y la cola Por revisar. Este módulo
// entrega los datos y el juicio; aquel decide cuándo mostrarlos y cuándo apagarlos.
//
// ─── DOS COSAS QUE EL MAESTRO NO CIERRA, Y NO SE INVENTAN ──────────────────────────
//
//   · El método de estimación (§4.5 vs §0) del consumo de un tramo: ¿`wh_por_km_base` (§4.5) o el
//     `rango_efectivo` de la fórmula única (§0)? El maestro define las dos piezas sin decir
//     cuál alimenta la señal — **pregunta 13**. Acá el método es un PARÁMETRO explícito de la
//     función, con los dos implementados y ninguno por omisión: quien llama tiene que elegir,
//     y el día que el dueño responda se borra el que no quedó.
//   · La HORA LÍMITE del «no quedó enchufado» — **pregunta 8**. El predicado recibe el límite
//     ya resuelto; no hay default escondido.
//
// «No quedó enchufado» sale DIRECTO de `turnos.enchufado_confirmado` (§4.5): sin estimación de
// por medio, que es lo que lo hace la única de las tres señales verificable sin la pregunta 13.

/** Los dos métodos que el maestro deja sobre la mesa. La pregunta 13 elige uno. */
export const METODOS_DE_ESTIMACION = ["wh_por_km", "rango_efectivo"] as const;
export type MetodoDeEstimacion = (typeof METODOS_DE_ESTIMACION)[number];

/** Puntos porcentuales sobre la reserva que encienden el amarillo (Anexo B). */
const HOLGURA_AMARILLA_PP = 5;
/** Retorno proyectado por debajo del cual el Anexo B pone rojo. */
const RETORNO_MINIMO_PCT = 15;

export type EstadoDeSenal = "verde" | "amarillo" | "rojo";

export type Tramo = {
  socActualPct: number;
  kmDelTramo: number;
  datos: DatosEv & { whPorKmBase: number | null };
  parametros?: ParametrosDeEnergia;
};

/**
 * Cuánta CARGA (en puntos de SOC) consume un tramo, por el método que se le pida.
 *
 * `null` cuando falta el dato que ese método necesita. Es la misma regla que la fórmula única:
 * sin dato no hay cálculo, y un cero se leería como «no consume nada» — que en una señal de
 * energía es el peor error posible, porque apaga la alarma en vez de encenderla.
 */
export function consumoDelTramoPct(tramo: Tramo, metodo: MetodoDeEstimacion): number | null {
  if (tramo.kmDelTramo < 0) return null;

  if (metodo === "wh_por_km") {
    // Vía §4.5: los Wh que el vehículo gasta por km, contra la capacidad de su batería.
    const { whPorKmBase, bateriaWh } = {
      whPorKmBase: tramo.datos.whPorKmBase,
      bateriaWh: (tramo.datos as { bateriaWh?: number | null }).bateriaWh ?? null,
    };
    if (whPorKmBase === null || bateriaWh === null || bateriaWh <= 0) return null;
    return ((whPorKmBase * tramo.kmDelTramo) / bateriaWh) * SOC.maximo;
  }

  // Vía §0: qué fracción del rango efectivo se lleva el tramo.
  const rango = rangoEfectivoKm(tramo.datos, tramo.parametros);
  if (rango === null || rango <= 0) return null;
  return (tramo.kmDelTramo / rango) * SOC.maximo;
}

/** El SOC que quedaría al terminar el tramo, o `null` si no se puede estimar. */
export function socProyectadoPct(tramo: Tramo, metodo: MetodoDeEstimacion): number | null {
  const consumo = consumoDelTramoPct(tramo, metodo);
  if (consumo === null) return null;
  return tramo.socActualPct - consumo;
}

/**
 * El estado del dominio Flota/EV para un tramo, según el Anexo B.
 *
 * `null` cuando no se puede estimar. NO es verde: verde afirma que el vehículo llega, y
 * afirmarlo sin datos es exactamente lo que el §5.7 prohíbe con el estado vacío accionable.
 */
export function estadoDelTramo(
  tramo: Tramo,
  metodo: MetodoDeEstimacion,
): EstadoDeSenal | null {
  const proyectado = socProyectadoPct(tramo, metodo);
  if (proyectado === null) return null;
  const reserva = reservaPctDe(tramo.parametros);

  // ROJO primero: el Anexo B los ordena así y el orden importa — un tramo que dispara las dos
  // condiciones es rojo, no amarillo. Mostrar el menor de dos males es cómo una alarma deja de
  // creerse.
  const consumo = consumoDelTramoPct(tramo, metodo)!;
  if (tramo.socActualPct < consumo) return "rojo";
  if (proyectado < RETORNO_MINIMO_PCT) return "rojo";
  if (proyectado < reserva + HOLGURA_AMARILLA_PP) return "amarillo";
  return "verde";
}

/**
 * «No quedó enchufado» a la hora límite (Anexo B, rojo).
 *
 * Sale DIRECTO de `turnos.enchufado_confirmado`, sin estimación de por medio: es la única de
 * las tres señales de este dominio que no depende de la pregunta 13.
 *
 * Los tres valores de `enchufadoConfirmado` significan cosas distintas y ninguna se puede
 * confundir: `true` quedó enchufado, `false` no quedó, `null` NADIE PREGUNTÓ TODAVÍA — un turno
 * que no cerró. Tratar el `null` como `false` pondría en rojo a cada vehículo que todavía está
 * trabajando.
 */
export function sinEnchufar(
  turno: { enchufadoConfirmado: boolean | null; cerradoEn: Date | null },
  horaLimite: Date,
  ahora: Date,
): boolean {
  if (turno.cerradoEn === null) return false;
  if (turno.enchufadoConfirmado !== false) return false;
  return ahora >= horaLimite;
}

/** Los umbrales de alerta del §0, para que el fixture del hito (e) los lea de un solo lugar. */
export const UMBRALES_DE_ALERTA = EV.umbrales_alerta_pct;
