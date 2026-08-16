// «Máx 2 niveles de profundidad» como estructura testeable [AC-FMIG-21] — §5.1, §5.5.
//
// AC-FMIG-01 publicó la regla como CONSTANTE; una constante publicada no puede fallar, así que
// el oráculo conductual quedó declarado para este AC. `servidor/manifiesto.ts` ya deja escrito
// que el manifest es "entitlements × rol... estructura de datos testeable" para este chequeo —
// esta es esa estructura y su regla, PURA (sin BD), para poder mutarla sin un navegador ni un
// cluster: `e2e/profundidad-manifiesto.spec.ts` la corre además contra el manifest SERVIDO de
// verdad, sobre el covering array entitlements × rol.
//
// Nivel 0 = la raíz (no cuenta). Los ítems del manifest son nivel 1. Un ítem con `subitems` es
// nivel 2. Un `subitem` que a su vez tuviera `subitems` sería nivel 3 — eso es lo que este
// chequeo tiene que poder detectar como rebote.

export type NodoDeNavegacion = {
  readonly subitems?: readonly NodoDeNavegacion[];
};

export function profundidadDeManifiesto(items: readonly NodoDeNavegacion[]): number {
  if (items.length === 0) return 0;
  let maxima = 0;
  for (const item of items) {
    const delHijo = item.subitems ? profundidadDeManifiesto(item.subitems) : 0;
    if (delHijo > maxima) maxima = delHijo;
  }
  return 1 + maxima;
}

export const PROFUNDIDAD_MAXIMA = 2;

export function profundidadValida(items: readonly NodoDeNavegacion[]): boolean {
  return profundidadDeManifiesto(items) <= PROFUNDIDAD_MAXIMA;
}
