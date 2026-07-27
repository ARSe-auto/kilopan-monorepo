// Formato es-CL. Toda cifra visible en la UI pasa por aquí — nunca un template
// literal directo con `.toFixed()` o similar (grep de gate en guardrail.sh evoluciona
// para bloquear eso una vez exista UI real). El componente que renderiza el resultado
// debe aplicar `tabular-nums` (packages/miga tokens.tabularNums).
import { gramosAKgTexto } from "./peso.ts";

/** gramos (entero) -> "12,45 kg" — coma decimal, sin ceros de relleno. Hallazgo menor de
 *  la auditoría: la versión anterior fijaba SIEMPRE 3 decimales ("1,000 kg" para 1 kilo),
 *  que en una pantalla se lee como "mil kilos". Reusa gramosAKgTexto (comun/peso.ts), que
 *  ya resolvía exactamente este mismo problema para el campo editable de pesaje. */
export function formatearKg(gramos: number): string {
  if (!Number.isInteger(gramos)) {
    throw new RangeError(`formatearKg: gramos debe ser entero (${gramos})`);
  }
  return `${gramosAKgTexto(gramos)} kg`;
}

/** CLP entero -> "$12.500" — sin decimales, punto de miles. */
export function formatearClp(clp: number): string {
  if (!Number.isInteger(clp)) {
    throw new RangeError(`formatearClp: clp debe ser entero (${clp})`);
  }
  const conMiles = Math.abs(clp).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${clp < 0 ? "-" : ""}$${conMiles}`;
}

/** "45.000" o "45.000,50" -> 45000 (redondeado). Inverso de formatearClp: en Chile el
 *  punto es separador de miles y la coma es decimal — `Number("45.000")` da 45 y pierde
 *  tres ceros, que es exactamente el bug que esta función existe para no repetir. */
export function parsearClp(texto: string): number {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".");
  return Math.round(Number(limpio || "0"));
}

/** Date -> "dd-mm-aaaa", con reloj de servidor (el llamador decide qué Date pasar:
 *  `recibido_at` para negocio, `capturado_at` solo para diagnóstico/TCK). */
export function formatearFecha(fecha: Date): string {
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const aaaa = fecha.getFullYear();
  return `${dd}-${mm}-${aaaa}`;
}

/** Date -> "dd-mm-aaaa hh:mm". Para el historial de pesajes: la fecha sola no basta
 *  cuando la pregunta es "¿a qué hora se pesó esto?" — el reloj de la panadería
 *  arranca antes del amanecer y varias bandejas del mismo producto pueden caer el
 *  mismo día. */
export function formatearFechaHora(fecha: Date): string {
  const hh = String(fecha.getHours()).padStart(2, "0");
  const min = String(fecha.getMinutes()).padStart(2, "0");
  return `${formatearFecha(fecha)} ${hh}:${min}`;
}
