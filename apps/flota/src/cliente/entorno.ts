// Las dos condiciones del §4.3, medidas en el navegador [AC-FIDN-05] — §5.4, §5.7.
//
// MEDIR, NO SUPONER. Las dos se pueden preguntar y las dos mienten si se preguntan mal:
//
//   · `display-mode: standalone` no es «la PWA está instalada»: es «esta ventana se abrió
//     desde el ícono». Alguien puede tener la app instalada y estar mirándola en una pestaña,
//     y en esa pestaña el navegador SÍ la puede cerrar cuando necesite memoria. Lo que importa
//     es la ventana que tiene delante, y por eso se lee de `matchMedia` y no de una bandera.
//     Se mira también `navigator.standalone`, que es la vía de iOS y no implementa la media
//     query en todas sus versiones — sin eso, media flota queda en «falta» haciendo todo bien.
//
//   · `persist()` se PIDE, no se consulta. En los navegadores que lo implementan, la concesión
//     depende de que la app la solicite —y de la interacción previa de la persona—; consultar
//     `persisted()` a secas devuelve `false` en un aparato que jamás preguntó, y la pantalla
//     mostraría «denegado» sin que nadie haya negado nada.

export type EntornoDelAparato = { isStandalone: boolean; storagePersisted: boolean };

/** iOS expone la instalación acá y no siempre por la media query. */
type NavegadorConStandalone = Navigator & { standalone?: boolean };

/** ¿Esta VENTANA se abrió desde el ícono de la pantalla de inicio? */
export function esStandalone(): boolean {
  const porMediaQuery =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return porMediaQuery || (navigator as NavegadorConStandalone).standalone === true;
}

/**
 * Pide persistencia. Devuelve si quedó concedida. No rebota nunca: un navegador sin la API es
 * un navegador sin persistencia garantizada, que es exactamente lo que hay que reportar —
 * tratarlo como un error dejaría a la pantalla sin qué decir.
 */
export async function pedirPersistencia(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Las dos condiciones, tal como están AHORA. Se vuelve a llamar en cada «Revisar». */
export async function entornoDelAparato(): Promise<EntornoDelAparato> {
  let storagePersisted = false;
  try {
    storagePersisted = (await navigator.storage?.persisted?.()) === true;
  } catch {
    storagePersisted = false;
  }
  return { isStandalone: esStandalone(), storagePersisted };
}
