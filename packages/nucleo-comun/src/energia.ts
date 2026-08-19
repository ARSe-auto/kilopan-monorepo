import { EV, SOC } from "./constants.ts";

// LA FÓRMULA DE ENERGÍA, IMPLEMENTADA UNA SOLA VEZ [AC-FVEH-09] — §0, §3.E1.12, §5.2-F1/F3.
//
// ═══ POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ ES EL ÚNICO ═══════════════════════════════
//
// El §0 pide la fórmula «en un solo lugar, familia canónica con grep-gate». No es prolijidad:
// el error que previene tiene nombre y es el más caro de este producto — **restar la reserva
// dos veces**. Ocurre así: alguien calcula el rango efectivo y le resta el 15% «para estar
// seguro»; más allá, el semáforo vuelve a restarlo porque el §0 dice que ahí va. El vehículo
// aparece «sin alcance» con media batería, el operador aprende a ignorar el semáforo, y el día
// que el semáforo tiene razón nadie le hace caso. Un guard existe para ESO, no para el estilo.
//
// `db/flota/gate-formula-energia.mjs` pone el build en rojo si alguien vuelve a escribir esta
// aritmética en otro archivo.
//
// ═══ DÓNDE ENTRA LA RESERVA, Y DÓNDE NO ══════════════════════════════════════════════
//
//   rango_efectivo = autonomia_nominal × SOH × factor_consumo        ← SIN reserva
//   max_distance   = SOC% × rango_efectivo − reserva_km              ← acá sí, UNA vez
//
// El rango efectivo es una propiedad del VEHÍCULO: cuánto rinde de verdad esta batería a esta
// altura de su vida. La reserva es una decisión de OPERACIÓN: cuánto margen quiere dejar esta
// empresa. Mezclarlas hace que dos preguntas distintas tengan una sola respuesta, y que
// cambiar el margen de la empresa parezca que la batería envejeció.
//
// ═══ NI UN NÚMERO ESCRITO ACÁ ════════════════════════════════════════════════════════
//
// Los defaults (factor de consumo, reserva, umbrales de alerta) viven en `constants.ts` y se
// importan. Este archivo tiene la ARITMÉTICA; el otro, los VALORES. El grep-gate de constantes
// vigila la segunda mitad y el de la fórmula, la primera.
//
// ═══ EL FOLLETO NO ES UN DATO ════════════════════════════════════════════════════════
//
// El Anexo A es explícito: 305 km CLTC de catálogo contra 185–245 km reales. Por eso ninguna
// función de acá inventa un valor cuando le falta uno: devuelven `null` y quien las llama
// muestra el estado vacío accionable del §5.7. Calcular con folleto es peor que no calcular —
// manda un camión a una ruta que no aguanta, con una cifra en pantalla que parecía medida.

/** Los datos EV del vehículo. Todos opcionales: el alta es progresiva (§5.4). */
export type DatosEv = {
  autonomiaNominalKm: number | null;
  sohPct: number | null;
};

/** Lo que el tenant puede mover desde `parametros` (§4.4). Sin fila, rige el default del §0. */
export type ParametrosDeEnergia = {
  factorConsumo?: number | null;
  reservaPct?: number | null;
};

export const factorDe = (p: ParametrosDeEnergia = {}): number =>
  p.factorConsumo ?? EV.factor_consumo_default;

export const reservaPctDe = (p: ParametrosDeEnergia = {}): number =>
  p.reservaPct ?? EV.reserva_pct_default;

/**
 * `rango_efectivo = autonomia_nominal × SOH × factor_consumo`, SIN reserva (§0).
 *
 * `null` cuando falta un dato EV del vehículo. Ese `null` es la señal de «estado vacío
 * accionable» del §5.7 y no un cero: un cero se ve igual que «no llega a ninguna parte», y un
 * vehículo recién dado de alta llega perfectamente — lo que falta es la ficha, no la batería.
 */
export function rangoEfectivoKm(datos: DatosEv, parametros: ParametrosDeEnergia = {}): number | null {
  if (datos.autonomiaNominalKm === null || datos.sohPct === null) return null;
  if (datos.autonomiaNominalKm <= 0) return null;
  return (datos.autonomiaNominalKm * (datos.sohPct / SOC.maximo)) * factorDe(parametros);
}

/** Los kilómetros de margen que la empresa se guarda. Se calcula acá y se resta UNA vez. */
export function reservaKm(rangoEfectivo: number, parametros: ParametrosDeEnergia = {}): number {
  return rangoEfectivo * (reservaPctDe(parametros) / SOC.maximo);
}

/**
 * `max_distance = SOC% × rango_efectivo − reserva_km` (§0).
 *
 * Es el ÚNICO lugar, junto con el semáforo, donde la reserva se resta. Queda disponible para
 * el VRP de E2 (§3.E2); en E1 lo consume el semáforo y nadie más.
 *
 * Nunca negativo: un vehículo con menos carga que su propia reserva no puede recorrer menos
 * que cero kilómetros, y un número negativo en pantalla se lee como un error de la app en vez
 * de como «este camión no sale».
 */
export function maxDistanceKm(
  socPct: number,
  datos: DatosEv,
  parametros: ParametrosDeEnergia = {},
): number | null {
  const rango = rangoEfectivoKm(datos, parametros);
  if (rango === null) return null;
  const disponible = (socPct / SOC.maximo) * rango;
  return Math.max(0, disponible - reservaKm(rango, parametros));
}

export type Semaforo = "alcanza" | "no_alcanza" | "sin_datos";

/**
 * El semáforo «Alcanza / No alcanza — recarga antes» del §5.2-F3.
 *
 * `sin_datos` NO es un tercer color de advertencia: es la ausencia de respuesta. Un vehículo
 * sin ficha EV o un día sin plan no dan «no alcanza» —eso afirmaría algo que nadie midió— y la
 * pantalla tiene que mostrar el estado vacío accionable, que dice qué falta cargar (§5.7).
 */
export function semaforoDeSalida(
  socPct: number | null,
  kmNecesarios: number | null,
  datos: DatosEv,
  parametros: ParametrosDeEnergia = {},
): Semaforo {
  if (socPct === null || kmNecesarios === null) return "sin_datos";
  const alcance = maxDistanceKm(socPct, datos, parametros);
  if (alcance === null) return "sin_datos";
  return alcance >= kmNecesarios ? "alcanza" : "no_alcanza";
}

/**
 * El umbral de alerta cruzado, o `null` si el SOC está por encima de todos (§0: 30/20/15/10).
 *
 * Devuelve el MÁS BAJO de los cruzados: con 12% se avisa «10» y no «30», porque el banner que
 * importa es el que describe la situación real. Los banners son NO bloqueantes (§5.2-F4) y su
 * superficie en ruta la renderiza el módulo de POD (hito e).
 */
export function umbralDeAlerta(socPct: number): number | null {
  const cruzados = EV.umbrales_alerta_pct.filter((u) => socPct <= u);
  return cruzados.length === 0 ? null : Math.min(...cruzados);
}
