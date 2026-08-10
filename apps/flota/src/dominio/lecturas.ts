import { SOC, RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";

// La degradación de una lectura declarada [AC-FVEH-05] — §4.2, §4.6, §0, §9.3 centinela 4.
//
// ─── NINGUNA DE ESTAS CONDICIONES RECHAZA. ESA ES TODA LA REGLA ─────────────────────
//
// Una lectura es CAPTURA: el mundo físico ya ocurrió. El chofer ya miró el tablero y ya tecleó
// lo que vio; si el servidor le contesta 422, ese dato no vuelve — la persona está manejando y
// la app acaba de perder el único registro que existía. Por eso el §4.2 dice «jamás rebota al
// sincronizar» y el centinela 4 lo pone como invariante con nombre: rechazos = 0.
//
// Lo que sí se hace es DEJAR DICHO que algo no cuadra: flag + evento + fila en `review_queue`.
// La diferencia entre eso y rebotar es la diferencia entre «tenemos el dato y sabemos que hay
// que mirarlo» y «no tenemos el dato».
//
// ─── LOS TRES CASOS DEL CENTINELA 4, Y UNO MÁS QUE APARECE SOLO ─────────────────────
//
// Los tres del §9.3.4 son SOC fuera de rango, odómetro menor al anterior y reloj desfasado. El
// cuarto —lectura sin turno— no está en esa lista porque el maestro no lo nombra, pero existe
// en cuanto `reading` es genérica: sin turno no hay vehículo al que proyectar (§4.6 le da a
// `reading` `instrumento?`, `turno?`, `parada?`, y ninguno es obligatorio). Rechazarla sería
// romper la regla de oro por un caso que el maestro ni siquiera prohíbe; entra con su flag.

export const MAGNITUDES = ["odometro", "soc"] as const;
export type Magnitud = (typeof MAGNITUDES)[number];

export const FLAGS = [
  "soc_fuera_de_rango",
  "odometro_retrocedido",
  "reloj_desfasado",
  "sin_turno",
  // El §0 lo nombra con estas letras en su fila de HTTP: una captura que llega con el módulo
  // apagado entra igual, con este flag y su fila en «Por revisar» [AC-FVEH-18]. Es el caso
  // donde la regla de oro se ve más clara: el dueño apagó algo en una oficina y el chofer ya
  // había tecleado el dato en la calle.
  "modulo_apagado",
] as const;
export type FlagDeLectura = (typeof FLAGS)[number];

export type Lectura = {
  magnitud: Magnitud;
  valor: number;
  /** La proyección que hoy tiene el vehículo, o `null` si es la primera lectura. */
  anterior: number | null;
  /** Cuándo lo midió el aparato y cuándo lo supo el servidor: el doble reloj del §4.6. */
  tsDispositivo: Date;
  recibidaEn: Date;
  tieneTurno: boolean;
  /** Si el módulo estaba encendido en la config CONGELADA del turno (§4.4, §5.5). */
  moduloEncendido: boolean;
};

/** Milisegundos de desfase tolerado entre el reloj del aparato y el del servidor (§0). */
const TOLERANCIA_DE_RELOJ_MS = RELOJ.drift_max_minutos * 60 * 1000;

/**
 * Qué tiene de raro esta lectura. Lista vacía = nada.
 *
 * Es una función pura y separada del servidor a propósito: el mismo juicio lo necesita el
 * CLIENTE para avisar ANTES de sincronizar (§4.2, «la validación bloqueante corre en el
 * cliente»), y dos copias del criterio se separan el día que alguien ajusta una.
 */
export function clasificar(lectura: Lectura): FlagDeLectura[] {
  const flags: FlagDeLectura[] = [];

  if (!lectura.tieneTurno) flags.push("sin_turno");
  if (!lectura.moduloEncendido) flags.push("modulo_apagado");

  if (lectura.magnitud === "soc" && (lectura.valor < SOC.minimo || lectura.valor > SOC.maximo)) {
    flags.push("soc_fuera_de_rango");
  }
  if (
    lectura.magnitud === "odometro" &&
    lectura.anterior !== null &&
    lectura.valor < lectura.anterior
  ) {
    flags.push("odometro_retrocedido");
  }
  // Valor absoluto: un reloj adelantado es tan sospechoso como uno atrasado, y solo uno de los
  // dos signos se ve si se compara sin él.
  const desfase = Math.abs(lectura.recibidaEn.getTime() - lectura.tsDispositivo.getTime());
  if (desfase > TOLERANCIA_DE_RELOJ_MS) flags.push("reloj_desfasado");

  return flags;
}

/**
 * ¿Alguna clase rechaza? NO, y por eso existe esta función: el centinela 4 necesita algo
 * concreto que asertar, y una promesa que solo vive en un comentario no se puede poner roja.
 */
export function rechaza(_flags: readonly FlagDeLectura[]): boolean {
  return false;
}

/**
 * Con qué severidad entra a la bandeja «Por revisar» (§5.6).
 *
 * `media` para todas: son anomalías de un dato, no incidentes. La `alta` está reservada para
 * lo que ya no se explica por el terreno —un aparato revocado que sigue sincronizando tres
 * días después (§4.3), un break-glass (§7.9)—, y gastarla acá haría que la bandeja dejara de
 * distinguir entre un dígito de más y alguien entrando a la base.
 */
export const SEVERIDAD_DE_LECTURA = "media";

/** El valor con el que la PROYECCIÓN se queda. La serie guarda siempre lo declarado (§4.6). */
export function valorProyectado(lectura: Lectura): number {
  if (lectura.magnitud === "soc") {
    return Math.min(SOC.maximo, Math.max(SOC.minimo, lectura.valor));
  }
  return lectura.anterior === null ? lectura.valor : Math.max(lectura.anterior, lectura.valor);
}
