// Formato es-CL. Toda cifra visible en la UI pasa por aquí — nunca un template
// literal directo con `.toFixed()` o similar (grep de gate en guardrail.sh evoluciona
// para bloquear eso una vez exista UI real). El componente que renderiza el resultado
// debe aplicar `tabular-nums` (packages/miga tokens.tabularNums).

/** gramos (entero) -> "12,450 kg" — coma decimal, 3 decimales fijos desde gramos. */
export function formatearKg(gramos: number): string {
  if (!Number.isInteger(gramos)) {
    throw new RangeError(`formatearKg: gramos debe ser entero (${gramos})`);
  }
  const kg = (gramos / 1000).toFixed(3).replace(".", ",");
  return `${kg} kg`;
}

/** CLP entero -> "$12.500" — sin decimales, punto de miles. */
export function formatearClp(clp: number): string {
  if (!Number.isInteger(clp)) {
    throw new RangeError(`formatearClp: clp debe ser entero (${clp})`);
  }
  const conMiles = Math.abs(clp).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${clp < 0 ? "-" : ""}$${conMiles}`;
}

/** Date -> "dd-mm-aaaa", con reloj de servidor (el llamador decide qué Date pasar:
 *  `recibido_at` para negocio, `capturado_at` solo para diagnóstico/TCK). */
export function formatearFecha(fecha: Date): string {
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const aaaa = fecha.getFullYear();
  return `${dd}-${mm}-${aaaa}`;
}
