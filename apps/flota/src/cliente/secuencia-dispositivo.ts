import type { AlmacenLocal } from "./outbox-local.ts";

// La secuencia monotónica del DISPOSITIVO [AC-FPOD-10] — §4.7.
//
// ─── POR QUÉ VIVE APARTE DEL OUTBOX PARTICIONADO ──────────────────────────────────
//
// `outbox-local.ts` particiona por (tenant, usuario) porque el §4.7 dice que las capturas de A
// tienen que sobrevivir a que B se autentique en el mismo teléfono. La secuencia de este archivo
// mide otra cosa: cuántos cierres de parada ha hecho ESTE APARATO en su historia, sin importar
// quién estaba autenticado en cada uno. Por eso la llave es UNA sola por origen y no se
// particiona por identidad — si se particionara, la secuencia de A se reiniciaría en 1 el día
// que B se autentica en el mismo teléfono, y el servidor vería un «hueco» que no es ni evicción
// ni manipulación, es solo un cambio de identidad ya cubierto por AC-FPOD-09. Del lado del
// servidor la fila que compara esta secuencia es `dispositivos` —una por ENROLAMIENTO, no por
// aparato físico—, así que la primera captura de una identidad nueva en un teléfono compartido
// arranca sin `secuencia_maxima` previa y no dispara nada: la comparación necesita una fila
// aterrizada antes para tener con qué contrastar (`dominio/pod-sync.ts::esHuecoDeSecuencia`).
//
// ─── QUÉ HUECO DETECTA ─────────────────────────────────────────────────────────────
//
// Si el navegador evicta este `localStorage` a mitad de un turno, o alguien edita el contador a
// mano, la próxima captura sale con un número que no es el siguiente exacto del que el servidor
// vio aterrizar último — eso es el hueco que AC-FPOD-10 pide dejar dicho, nunca perder en
// silencio.
//
// ─── POR QUÉ EL ALMACÉN LLENO O NEGADO NO BLOQUEA LA CAPTURA ──────────────────────
//
// Mismo criterio que `outbox-local.ts::guardarOutbox`: el hecho ya ocurrió (§4.2), y un
// `localStorage` que rebota no puede tumbar la entrega. Si no se pudo guardar el número nuevo,
// la PRÓXIMA captura repite el mismo valor — el servidor la ve como una secuencia que no avanza,
// no como un hueco, y eso es exactamente lo honesto: este aparato no sabe en qué número va.

const LLAVE_SECUENCIA = "flota.dispositivo.secuencia";

/** La secuencia guardada, o 0 si el aparato nunca cerró una parada (o el valor quedó ilegible). */
function secuenciaGuardada(almacen: AlmacenLocal): number {
  let crudo: string | null;
  try {
    crudo = almacen.getItem(LLAVE_SECUENCIA);
  } catch {
    return 0;
  }
  const numero = crudo === null ? 0 : Number(crudo);
  return Number.isInteger(numero) && numero >= 0 ? numero : 0;
}

/**
 * La PRÓXIMA secuencia del dispositivo — la reserva y la deja escrita en el mismo gesto, para
 * que dos toques seguidos jamás salgan con el mismo número [AC-FPOD-10]. Arranca en 1: `0` queda
 * reservado para «sin dato», el mismo valor que un cuerpo mal formado o una versión vieja de la
 * PWA deja en el servidor (`servidor/capturas.ts::leer`).
 */
export function siguienteSecuenciaDispositivo(almacen: AlmacenLocal): number {
  const siguiente = secuenciaGuardada(almacen) + 1;
  try {
    almacen.setItem(LLAVE_SECUENCIA, String(siguiente));
  } catch {
    /* almacén lleno o negado: la captura sigue, el hueco lo nota el servidor (ver comentario de
       cabecera). */
  }
  return siguiente;
}
