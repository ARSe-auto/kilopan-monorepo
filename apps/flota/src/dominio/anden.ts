import { randomBytes } from "node:crypto";
import { SESION } from "../../../../packages/nucleo-comun/src/constants.ts";

// La identidad rotatoria del dispositivo de andén [AC-FIDN-07] — §4.3, §5.4 F-D, §0 (`SESION`).
//
// ─── QUÉ DECIDE ESTE ARCHIVO Y QUÉ NO ─────────────────────────────────────────────
//
// Acá está lo que se puede decidir sin base y sin red: cuándo una identidad de andén se venció
// por inactividad, y qué forma tiene la huella con la que su outbox se particiona. La rotación
// misma —verificar el PIN, cerrar la anterior, abrir la nueva— necesita el cluster y vive en
// `servidor/anden.ts`. El reparto es el de AC-FIDN-06: la CURVA y los plazos se prueban puros,
// sin esperar tres minutos de reloj real, y contra la base se prueba lo que eso no puede dar.
//
// ─── POR QUÉ EL ANDÉN CADUCA Y EL TELÉFONO PERSONAL NO ────────────────────────────
//
// El §0 (`SESION`) lo separa a propósito, con la respuesta del dueño del 09-ago-2026: el teléfono
// personal ya es el segundo factor —enrolado, con secreto propio, revocable en 1 toque— así que
// pedirle el PIN al abrir la PWA suma toques sin agregar seguridad. El andén es lo contrario: es
// un aparato apoyado en una mesa por donde pasan varios operarios, y ahí la sesión que nadie
// cierra es la firma de quien se fue puesta sobre el trabajo de quien llegó. Por eso caduca sola.
//
// El plazo se LEE de la constante y no se repite acá: es la cifra canónica del §0 y una segunda
// copia es exactamente lo que el gate de constantes existe para impedir.

/** La huella con la que el outbox del §4.7 particiona a un operario en un aparato de andén.
 *  Misma forma que la huella del enrolamiento personal (sha256 en hexa, `dominio/secretos.ts`):
 *  el lote de sync manda UN campo y el servidor resuelve las dos. */
export const HUELLA_ANDEN = /^[0-9a-f]{64}$/;

/**
 * Una huella nueva para una pareja (aparato de andén, operario).
 *
 * ALEATORIA, no derivada de los ids: `firmaDelEnrolamiento` (servidor/capturas.ts) le anota el
 * hecho al aparato y al operario de la huella que trae el lote, así que una huella que se pueda
 * calcular con datos que otro conoce sería una forma de anotarle a un compañero una entrega que
 * no hizo. 32 bytes del generador del sistema, en hexa para que entre en la misma columna de
 * texto y en el mismo patrón que la otra.
 */
export function huellaNueva(): string {
  return randomBytes(32).toString("hex");
}

/**
 * ¿La identidad de andén se venció por inactividad? (§0 `SESION.anden_inactividad_minutos`).
 *
 * El borde es EXCLUYENTE: exactamente en el minuto tres todavía está viva, y se vence al pasarlo.
 * Un `>=` acá le quitaría al operario el último segundo del plazo que se le prometió, y en un
 * andén ese segundo es el que separa «sigo trabajando» de «tengo que tipear el PIN de nuevo»
 * mientras sostiene una caja.
 */
export function vencioPorInactividad(ultimoUso: Date, ahora: Date): boolean {
  const transcurridoMs = ahora.getTime() - ultimoUso.getTime();
  return transcurridoMs > SESION.anden_inactividad_minutos * 60_000;
}
