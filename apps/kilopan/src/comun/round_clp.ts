// Dinero = CLP entero, SIEMPRE. Ninguna otra parte del código redondea plata —
// toda cifra de dinero pasa por aquí antes de persistir o mostrarse (PROMPT_MAESTRO.md §4).
// Se escribe en `comun/` dentro de apps/kilopan (no en packages/nucleo-comun todavía):
// ver packages/nucleo-comun/README.md sobre el hito de extracción.

/** Redondea a CLP entero con la regla bancaria (mitad hacia el par) para evitar sesgo
 *  sistemático cuando se acumulan muchos redondeos (líneas de venta, prorrateos). */
export function roundClp(valor: number): number {
  if (!Number.isFinite(valor)) {
    throw new RangeError(`roundClp: valor no finito (${valor})`);
  }
  const piso = Math.floor(valor);
  const resto = valor - piso;
  if (resto < 0.5) return piso;
  if (resto > 0.5) return piso + 1;
  // resto === 0.5 exacto: redondeo bancario, hacia el par más cercano
  return piso % 2 === 0 ? piso : piso + 1;
}
