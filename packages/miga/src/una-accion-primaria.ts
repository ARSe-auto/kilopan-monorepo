// «Una acción primaria por pantalla» como estructura testeable [AC-FMIG-21] — §5.1.
//
// AC-FMIG-01 publicó la regla como CONSTANTE (§5.1: "una acción primaria por pantalla"), pero
// una constante publicada no puede fallar — el oráculo conductual quedó declarado para este AC.
//
// LA UNIDAD QUE SE CUENTA ES EL TIPO DE ACCIÓN, NO LA INSTANCIA. Una lista real (`/panel/funciones`
// con N funciones apagadas-y-en-plan, cada una con su propio botón "Encender") repite la MISMA
// acción una vez por fila — eso es la acción primaria de la pantalla ofrecida N veces, no N
// acciones primarias compitiendo. El AC lo dice con esas palabras para el caso análogo de terreno
// ("la aserción §5.1 es de unicidad, no de mera presencia") y el mismo criterio aplica acá: lo
// que puede poner esta pantalla en rojo es que aparezcan DOS TIPOS de acción `acento` a la vez
// (p. ej. "Invitar" y "Aprobar" simultáneos) — no cuántas filas repiten el mismo tipo.
//
// El TIPO sale del `data-testid` (ancla estable, ver `BotonPrimario.tsx`): el segmento antes del
// primer "-". La convención de nombres del repo es `<verbo>-<id-de-fila>` (`encender-<lookupKey>`,
// `guardar-<termKey>`) o `<verbo>` a secas cuando no hay fila (`invitar`) — el verbo ES la
// identidad de la acción; el resto es el dato de la fila.

export type BotonVisible = {
  testid: string;
  variante: "acento" | "neutro";
};

/** Los tipos DISTINTOS de acción primaria (`variante="acento"`) visibles en la pantalla. Vacío
 *  es un resultado válido (una pantalla puede no tener ninguna acción de énfasis, p. ej. una
 *  lista de formularios independientes donde cada fila se guarda sola). El caso de rebote es
 *  `.length > 1`: dos o más TIPOS compitiendo por el mismo énfasis visual. */
export function tiposDeAccionPrimaria(botones: readonly BotonVisible[]): string[] {
  const tipos = new Set<string>();
  for (const b of botones) {
    if (b.variante !== "acento") continue;
    const tipo = b.testid.split("-")[0];
    if (tipo) tipos.add(tipo);
  }
  return [...tipos].sort();
}

/** `true` si la pantalla respeta "una acción primaria" (cero o un tipo). `false` es el caso de
 *  rebote que este AC pide poder detectar. */
export function unaAccionPrimariaPorPantalla(botones: readonly BotonVisible[]): boolean {
  return tiposDeAccionPrimaria(botones).length <= 1;
}
