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

/** Entero estricto acotado a [min, max]. `max` por defecto es el techo de int4 para
 *  que el rango lo ataje la app y no el INSERT. */
export function aEnteroEnRango(valor: unknown, min: number, max: number = MAX_INT4): number | null {
  const n = aEnteroEstricto(valor);
  if (n === null || n < min || n > max) return null;
  return n;
}
