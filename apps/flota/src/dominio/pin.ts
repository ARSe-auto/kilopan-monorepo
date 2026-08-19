import { PIN } from "../../../../packages/nucleo-comun/src/constants.ts";

// El PIN de operario y su bloqueo [AC-FIDN-06] — §0, §4.3, §5.4 F-D.
//
// EL BLOQUEO ES POR USUARIO, JAMÁS POR DISPOSITIVO, y no es un detalle de implementación: en
// el andén rotan varios operarios sobre el MISMO aparato, y un bloqueo por dispositivo dejaría
// a todo el turno afuera porque uno se equivocó cinco veces. Por eso el contador y la fecha
// viven en `usuarios` y no en `dispositivos` (AC-FIDN-01).
//
// LA CURVA la dictó Alexis el 09-ago-2026 (pregunta 9): la espera se duplica desde medio
// minuto y se topa. Los valores están en `PIN` del canónico §0 y acá se LEEN — escribirlos de
// nuevo sería la copia que se queda vieja, y el gate de constantes lo pondría en rojo.
//
// POR QUÉ HAY TOPE: el bloqueo es por usuario, pero el que espera es el turno. Sin tope, la
// quinta racha de un operario distraído deja el aparato de andén inutilizable el resto de la
// madrugada, y el costo no lo paga quien se equivocó sino la carga que no salió.

/** Cuánto se espera tras el n-ésimo bloqueo consecutivo (n = 1 el primero). */
export function esperaSegundos(bloqueoNumero: number): number {
  if (bloqueoNumero < 1) return 0;
  const sinTope = PIN.backoff_inicial_segundos * PIN.backoff_factor ** (bloqueoNumero - 1);
  return Math.min(sinTope, PIN.backoff_tope_segundos);
}

/** Estado del usuario que este módulo lee y devuelve. Es exactamente lo que hay en la fila. */
export type EstadoPin = {
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
};

export type Veredicto =
  | { tipo: "correcto"; estado: EstadoPin }
  | { tipo: "incorrecto"; estado: EstadoPin }
  | { tipo: "bloqueado"; estado: EstadoPin; faltanSegundos: number };

export function estaBloqueado(estado: EstadoPin, ahora: Date): boolean {
  return estado.bloqueado_hasta !== null && estado.bloqueado_hasta.getTime() > ahora.getTime();
}

/**
 * Aplica UN intento y devuelve el veredicto con el estado que hay que guardar.
 *
 * Función pura a propósito: la parte que toca la base es una transacción de tres líneas
 * (`db`/`servidor/pin.ts`), y toda la regla —cuándo bloquea, cuánto, cuándo resetea— se
 * prueba acá sin cluster, sin reloj real y sin esperar quince minutos para ver el tope.
 *
 * MIENTRAS ESTÁ BLOQUEADO NO SE CUENTA EL INTENTO ni se verifica el hash. Contarlos dejaría
 * que un atacante que ya no puede entrar siga empujando la espera del legítimo hacia el tope
 * —castigar al bloqueado por intentar es castigar al operario que se confundió de PIN—, y
 * verificar el hash gastaría el argon2id de cada golpe, que es justo lo que un ataque quiere.
 */
export function evaluarIntento(estado: EstadoPin, esCorrecto: boolean, ahora: Date): Veredicto {
  if (estaBloqueado(estado, ahora)) {
    const faltan = Math.ceil((estado.bloqueado_hasta!.getTime() - ahora.getTime()) / 1000);
    return { tipo: "bloqueado", estado, faltanSegundos: faltan };
  }

  if (esCorrecto) {
    // Un acierto borra la racha entera (respuesta del dueño): la penalización castiga la
    // racha en curso, no la historia del operario.
    return { tipo: "correcto", estado: { intentos_fallidos: 0, bloqueado_hasta: null } };
  }

  const intentos = estado.intentos_fallidos + 1;
  // El bloqueo cae en cada múltiplo del umbral y el contador NO se reinicia: es lo que hace
  // que la racha se pueda contar sin agregarle una columna a la tabla, y que el segundo
  // bloqueo del mismo episodio espere el doble que el primero.
  const bloqueoNumero = Math.floor(intentos / PIN.intentos_hasta_bloqueo);
  const bloquea = intentos % PIN.intentos_hasta_bloqueo === 0;

  return {
    tipo: "incorrecto",
    estado: {
      intentos_fallidos: intentos,
      bloqueado_hasta: bloquea
        ? new Date(ahora.getTime() + esperaSegundos(bloqueoNumero) * 1000)
        : estado.bloqueado_hasta,
    },
  };
}

/** El estado con el que el dueño reabre el acceso (§5.4: desbloquear y rotar PIN). */
export const DESBLOQUEADO: EstadoPin = { intentos_fallidos: 0, bloqueado_hasta: null };

/** Forma del PIN. El largo es del §0; acá no se elige, se lee. */
export function formaValida(pin: string): boolean {
  return new RegExp(`^\\d{${PIN.digitos}}$`).test(pin);
}
