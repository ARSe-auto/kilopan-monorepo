// El candado entrega←manifiesto [AC-FRUT-22] — KR-29, decisión del dueño 08-ago-2026 (D1),
// ancla del art. 55 DL 825 en el DTE-gate del manifiesto (§7.3).
//
// ─── LA REGLA, EN UNA FRASE ────────────────────────────────────────────────────────
//
// Ninguna parada de entrega se abre sin el manifiesto de la carga que la abastece confirmado.
// Una parada de entrega puede agrupar ítems de varias empresas (§3.E1.5): el candado exige que
// TODAS ellas tengan su sub-manifiesto confirmado en alguna parada de carga de la misma ruta —
// no alcanza con que una empresa haya confirmado si otra todavía no.
//
// ─── FUNCIÓN PURA, IGUAL QUE `dominio/custodia.ts` ─────────────────────────────────
//
// El §4.2 pide que la validación bloqueante corra en el CLIENTE contra el snapshot: el mismo
// juicio lo necesita el servidor para armar la respuesta que el cliente lee. Separarlo del
// servidor es lo que evita que las dos copias del criterio se desalineen el día que alguien
// ajuste una.

export type EmpresaDeLaEntrega = { id: string; razonSocial: string };

export type CandadoDeEntrega =
  | { abierta: true }
  | { abierta: false; empresasFaltantes: EmpresaDeLaEntrega[] };

/**
 * Evalúa el candado: abierta si TODAS las empresas de la entrega tienen su sub-manifiesto
 * confirmado en alguna parada de carga de la ruta.
 */
export function evaluarCandadoDeEntrega(datos: {
  empresasDeLaEntrega: EmpresaDeLaEntrega[];
  empresasConManifiestoConfirmado: ReadonlySet<string>;
}): CandadoDeEntrega {
  const empresasFaltantes = datos.empresasDeLaEntrega.filter(
    (empresa) => !datos.empresasConManifiestoConfirmado.has(empresa.id),
  );
  return empresasFaltantes.length === 0 ? { abierta: true } : { abierta: false, empresasFaltantes };
}

/**
 * El texto que nombra la vía (§7.6: jamás una modal, jamás un candado mudo, jamás solo color).
 * Vive acá y no en el componente: es el mismo criterio que el servidor podría necesitar para
 * componer un aviso, y una frase escrita en dos lugares es una frase que se desalinea.
 */
export function textoDelCandado(candado: CandadoDeEntrega): string | null {
  if (candado.abierta) return null;
  const nombres = candado.empresasFaltantes.map((e) => e.razonSocial).join(", ");
  return (
    `Todavía no se puede abrir: falta confirmar en el andén el manifiesto de ${nombres}. ` +
    "Confirmalo ahí, o bajá esos bultos del manifiesto en la parada de carga."
  );
}
