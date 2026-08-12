import { SEMAFORO, FORMATOS } from "../../../../packages/nucleo-comun/src/constants.ts";

// Nivel 0 del «Hoy» (spec 05, §2.1) [AC-FSEM-01].
//
// La EVALUACIÓN de cada señal —cruzar un umbral contra `eventos`/`paradas`/`client_metric`,
// abrir o cerrar una fila de `review_queue`— es de otros ACs de este módulo (AC-FSEM-02 la
// histéresis, AC-FSEM-07/08/16-19 cada dominio). Este archivo solo decide, dado el estado YA
// evaluado de cada dominio, QUÉ tarjetas van al tablero y CÓMO se resumen — la regla del
// §5.6-N0: verde no comunica nada más que el agregado, y solo amarillo/rojo exponen la cola.

export type ColorSemaforo = "verde" | "amarillo" | "rojo";

/** Los 5 dominios fijos del Anexo B, en el orden en que la tabla los declara. */
export const DOMINIOS_FIJOS = [
  { clave: "entregas_vs_plan", titulo: "Entregas vs plan" },
  { clave: "turnos_conductores", titulo: "Turnos/conductores" },
  { clave: "flota_energia_ev", titulo: "Flota/energía EV" },
  { clave: "datos_sync", titulo: "Datos/sync" },
  { clave: "caja_custodia_liquidacion", titulo: "Caja/custodia/liquidación" },
] as const;

/** El sexto, condicionado a modo `daas` y a que exista una empresa con SLA pactado (§4.5). */
export const TARJETA_SLA = { clave: "daas_sla", titulo: "SLA por contrato" } as const;

export type ClaveDominio = (typeof DOMINIOS_FIJOS)[number]["clave"] | typeof TARJETA_SLA.clave;

export type ExcepcionCruda = {
  id: string;
  descripcion: string;
  record_time: Date;
};

/** El estado YA evaluado de un dominio, tal como lo entregaría su `signal_rule`. */
export type EstadoDominio = {
  clave: ClaveDominio;
  color: ColorSemaforo;
  agregado: { numerador: number; denominador: number };
  excepciones: ExcepcionCruda[];
};

export type TarjetaHoy = {
  clave: ClaveDominio;
  titulo: string;
  color: ColorSemaforo;
  /** SOLO en verde: «N/M» es-CL. Verde no notifica ni expone cola (§5.6-N0). */
  agregadoTexto: string | null;
  /** SOLO en amarillo/rojo. */
  contadorExcepciones: number | null;
  /** SOLO en amarillo/rojo: la de `record_time` menor — la secuencia del servidor manda. */
  excepcionMasAntigua: ExcepcionCruda | null;
};

function formatearAgregado(numerador: number, denominador: number): string {
  const cifras = new Intl.NumberFormat(FORMATOS.locale);
  return `${cifras.format(numerador)}/${cifras.format(denominador)}`;
}

function masAntiguaPorRecordTime(excepciones: ExcepcionCruda[]): ExcepcionCruda | null {
  if (excepciones.length === 0) return null;
  return excepciones.reduce((antigua, actual) => (actual.record_time < antigua.record_time ? actual : antigua));
}

function resumirTarjeta(estado: EstadoDominio, titulo: string): TarjetaHoy {
  const esVerde = estado.color === "verde";
  return {
    clave: estado.clave,
    titulo,
    color: estado.color,
    agregadoTexto: esVerde ? formatearAgregado(estado.agregado.numerador, estado.agregado.denominador) : null,
    contadorExcepciones: esVerde ? null : estado.excepciones.length,
    excepcionMasAntigua: esVerde ? null : masAntiguaPorRecordTime(estado.excepciones),
  };
}

/**
 * Selecciona y resume las tarjetas del Nivel 0, dado el estado evaluado de cada dominio.
 *
 * Un dominio SIN estado en `estados` no renderiza tarjeta — ni hueco ni candado: así es como
 * la SLA desaparece con seed C (`mi_flota`, sin empresa con `otd_comprometido_pct`) sin dejar
 * un lugar vacío donde iría. El tope sale de la familia canónica (`SEMAFORO.tarjetas_max`),
 * jamás de un número escrito acá: agregar un séptimo dominio sin subir esa constante hace
 * fallar esta función antes de llegar a la pantalla.
 */
export function tarjetasNivelCero(estados: EstadoDominio[]): TarjetaHoy[] {
  const porClave = new Map(estados.map((estado) => [estado.clave, estado]));
  const orden = [...DOMINIOS_FIJOS, TARJETA_SLA];

  const tarjetas: TarjetaHoy[] = [];
  for (const { clave, titulo } of orden) {
    const estado = porClave.get(clave);
    if (!estado) continue;
    tarjetas.push(resumirTarjeta(estado, titulo));
  }

  if (tarjetas.length > SEMAFORO.tarjetas_max) {
    throw new Error(
      `nivel 0 quiere renderizar ${tarjetas.length} tarjetas, sobre el tope de SEMAFORO.tarjetas_max ` +
        `(${SEMAFORO.tarjetas_max}) — revisar la lista de dominios antes de sumar una tarjeta más`,
    );
  }
  return tarjetas;
}
