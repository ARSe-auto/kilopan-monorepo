// Validación de entrada ANTES de tocar la base. Nace de la auditoría de red-team:
// una decena de endpoints devolvía HTTP 500 con el mensaje crudo de Postgres
// (nombres de constraints y columnas) porque la capa de app confiaba en que la BD
// validara por ella — un uuid mal formado reventaba en el cast, un monto sobre el
// máximo de int4 en el INSERT. Un 500 no es solo mala UX: filtra el esquema y, para
// la cola offline, es "reintentable" — el cliente reintenta en loop una petición que
// nunca va a entrar.

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Máximo de `integer` (int4) en Postgres. Todas las columnas de CLP y gramos son
 *  integer: pasarse revienta el INSERT con "value out of range". */
export const MAX_INT4 = 2_147_483_647;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && RE_UUID.test(valor);
}

/** Normaliza a minúsculas. Postgres trata `uuid` como insensible a mayúsculas, pero
 *  JS NO: un `Map`/`Set` con la clave cruda ve "A1B2…" y "a1b2…" como dos productos
 *  distintos. Esa asimetría permitía burlar el acumulador anti-sobreventa de
 *  /api/ventas mandando la misma línea dos veces con distinta capitalización. */
export function normalizarUuid(valor: string): string {
  return valor.toLowerCase();
}

/** Entero ESTRICTO. Rechaza a propósito el separador de miles chileno: `Number("25.000")`
 *  es 25, no 25.000, así que una guía de $25.000 se registraba como $25 —
 *  subdeclaración de 1000x ante el SII, silenciosa y sin error. Acepta el número, o el
 *  string de solo dígitos; nada más. Devuelve null si no es válido. */
export function aEnteroEstricto(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isInteger(valor) ? valor : null;
  if (typeof valor === "string" && /^\d+$/.test(valor.trim())) {
    const n = Number(valor.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** `capturado_at` lo pone el RELOJ DEL TELÉFONO — tiene que venir del cliente, porque
 *  una entrega o un pesaje hechos sin señal se registran cuando vuelve la red y la
 *  hora del servidor mentiría. Pero sin acotarlo, el repartidor podía mover entregas a
 *  cualquier día con solo cambiar la hora del equipo, y esa fecha alimenta la
 *  conciliación diaria (red-team). Se acepta una ventana generosa hacia atrás —la cola
 *  offline puede tardar días en drenar— y muy poca hacia adelante (solo desfase de
 *  reloj). */
const DIAS_ATRAS_MAX = 7;
const MINUTOS_ADELANTE_MAX = 60;

export function fechaCapturaValida(valor: unknown, ahora: number = Date.now()): boolean {
  if (typeof valor !== "string") return false;
  const t = Date.parse(valor);
  if (Number.isNaN(t)) return false;
  if (t > ahora + MINUTOS_ADELANTE_MAX * 60_000) return false;
  if (t < ahora - DIAS_ATRAS_MAX * 24 * 60 * 60_000) return false;
  return true;
}

/** Entero estricto acotado a [min, max]. `max` por defecto es el techo de int4 para
 *  que el rango lo ataje la app y no el INSERT. */
export function aEnteroEnRango(valor: unknown, min: number, max: number = MAX_INT4): number | null {
  const n = aEnteroEstricto(valor);
  if (n === null || n < min || n > max) return null;
  return n;
}

// AC-SEC-09: auditoría de límites de negocio validados SOLO en el cliente. Tres huecos
// reales, ninguno con respaldo de servidor: `pesoValido()` (comun/peso.ts) solo gatea el
// botón de /vender y /pedidos —el mismo comentario del archivo dice "no valida de
// verdad"— pero /api/ventas y /api/pedidos no repetían el techo; nada topaba la
// cantidad de líneas de un carro o pedido; y "motivo" de anulación/corrección/override
// solo exigía no-vacío, sin techo de largo, en tres rutas distintas.

/** Techo de gramos por línea de venta o pedido — el mismo 100 kg que exige el CHECK de
 *  `pan.pesajes` y `pan.venta_lineas`, y el mismo `MAX_GRAMOS` que gatea el botón en el
 *  cliente (comun/peso.ts). `pan.pedido_lineas` no tiene ese CHECK en la BD todavía. */
export const MAX_GRAMOS_LINEA = 100_000;

/** Techo de líneas por venta o pedido. Sin este límite un POST directo (sesión válida,
 *  sin pasar por la UI) podía mandar miles de líneas en una sola transacción. */
export const MAX_LINEAS_POR_DOCUMENTO = 200;

/** Techo de largo para los motivos de auditoría de anulación de venta, corrección de
 *  cierre de caja y salida a ruta con bultos pendientes: las tres columnas son `text`
 *  sin CHECK de largo, y las tres rutas solo exigían "no vacío". */
export const MAX_LARGO_MOTIVO = 500;
