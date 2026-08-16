// La ecuación de cierre por empresa, del lado del que la tiene que responder [AC-FRUT-11]
// — §3.E1.6, §4.5, §5.2 F5, §4.2, §4.8.
//
// ─── ACÁ NO SE CALCULA LA ECUACIÓN: SE DECIDE QUÉ HACER CON ELLA ──────────────────
//
// Los números vienen de `ecuacion_de_cierre()` en la base, que es donde el §4.5 pone las reglas
// de negocio. Este módulo hace lo otro: contestar si la ruta puede cerrar, y aplicar la
// clasificación táctil del descuadre. Es lo que el CLIENTE necesita para bloquear ANTES de
// mandar nada (§4.2: la validación bloqueante corre en el cliente contra el snapshot), y lo
// mismo que el servidor necesita para saber si lo que le llegó por sync entra degradado.
//
// Una sola copia del criterio, por la misma razón que `custodia.ts`: dos se separan el día que
// alguien ajusta una, y ese día el chofer bloquea por algo que el servidor deja pasar.
//
// ─── LA RUTA NO CIERRA DESCUADRADA, Y LA SALIDA NO ES UN CAMPO DE TEXTO ───────────
//
// El §5.2 F5 lo resuelve con clasificación TÁCTIL: la diferencia se asigna a `devuelto` o a
// `faltante declarado` —los términos de la propia ecuación— con un toque. No hay un tercer
// término «sin explicar», y es deliberado: existiendo, todo descuadre terminaría ahí, y la
// reconciliación diaria del §6 dejaría de reconciliar nada.
//
// ─── NI UN SOLO CLP ───────────────────────────────────────────────────────────────
//
// El §4.8 y el §5.2 F5: el chofer ve km, bultos y SOC, JAMÁS dinero. En este módulo eso es
// literal — todo lo que se mueve acá son bultos enteros, y no hay ningún tipo que pueda cargar
// un peso. La tabla del cierre tampoco tiene dónde guardarlo.

/** El renglón de UNA empresa, tal como lo devuelve `ecuacion_de_cierre()`. Todo en bultos. */
export type TerminosDeEmpresa = {
  empresa_cliente_id: string;
  empresa: string;
  cargado: number;
  entregado: number;
  devuelto: number;
  faltante: number;
};

/** Los dos destinos posibles de un descuadre (§5.2 F5). No hay un tercero. */
export const DESTINOS_DEL_DESCUADRE = ["devuelto", "faltante"] as const;
export type DestinoDelDescuadre = (typeof DESTINOS_DEL_DESCUADRE)[number];

/**
 * Lo que sobra del lado izquierdo: `cargado - entregado - devuelto - faltante`.
 *
 * Cero = cuadra. Positiva = subió más de lo que se sabe dónde quedó. NEGATIVA = se entregó o se
 * declaró más de lo que subió, y también es un descuadre: pasa cuando el andén contó de menos, y
 * tratarla como «cuadra» dejaría entrar precisamente el error que más se repite.
 */
export function diferenciaDe(t: TerminosDeEmpresa): number {
  return t.cargado - t.entregado - t.devuelto - t.faltante;
}

/** ¿Cuadra la empresa? */
export function cuadra(t: TerminosDeEmpresa): boolean {
  return diferenciaDe(t) === 0;
}

/**
 * ¿Puede cerrar la ruta? Solo si cuadran TODAS sus empresas.
 *
 * Una ruta sin empresas cuadra: no hay nada que reconciliar, y bloquear ahí dejaría al chofer sin
 * poder cerrar un día en que no cargó nada.
 */
export function puedeCerrar(terminos: readonly TerminosDeEmpresa[]): boolean {
  return terminos.every(cuadra);
}

/** Las empresas que todavía no cuadran, en el orden en que llegaron. */
export function descuadradas(terminos: readonly TerminosDeEmpresa[]): TerminosDeEmpresa[] {
  return terminos.filter((t) => !cuadra(t));
}

/**
 * La clasificación táctil: asigna TODA la diferencia de una empresa a uno de los dos términos.
 *
 * Toda y no una parte, porque es un toque: partir la diferencia exige teclear, y el §7.6 no
 * quiere tipeo libre obligatorio en terreno. Quien tenga que partirla toca dos veces —clasifica
 * una parte, vuelve a mirar el resto—, y para eso esta función se aplica sobre el resultado de sí
 * misma sin sorpresas.
 *
 * Con diferencia negativa la asignación restaría, y eso convertiría «se declaró de más» en un
 * `devuelto` negativo que la base rechaza por CHECK. Así que ahí no se toca nada: ese descuadre se
 * arregla corrigiendo el conteo, no clasificándolo.
 */
export function clasificar(
  t: TerminosDeEmpresa,
  destino: DestinoDelDescuadre,
): TerminosDeEmpresa {
  const diferencia = diferenciaDe(t);
  if (diferencia <= 0) return t;
  return destino === "devuelto"
    ? { ...t, devuelto: t.devuelto + diferencia }
    : { ...t, faltante: t.faltante + diferencia };
}

/**
 * El flag con el que entra un cierre descuadrado que llegó por sync (§4.2).
 *
 * Uno solo y con nombre propio, como los cinco de `custodia.ts`: la bandeja «Por revisar» del
 * §5.6 se lee por origen, y «la ruta cerró sin cuadrar» es una pregunta distinta de todas las
 * demás — es la que alimenta la señal Caja/custodia del semáforo (Anexo B).
 */
export const FLAG_DESCUADRADO = "cierre_descuadrado";

/**
 * ¿Este cierre entra degradado? Sí exactamente cuando alguna empresa no cuadra.
 *
 * Y NO rebota, nunca: el día ya terminó y el camión ya volvió. Un 422 no le devuelve al chofer la
 * reconciliación que hizo en el estacionamiento — se la borra, y con ella la única constancia de
 * qué faltó. Por eso el bloqueo del §5.2 F5 vive en el cliente y acá solo se deja dicho.
 */
export function flagsDelCierre(terminos: readonly TerminosDeEmpresa[]): string[] {
  return puedeCerrar(terminos) ? [] : [FLAG_DESCUADRADO];
}

/** Con qué severidad entra a «Por revisar» (§5.6). Ver `SEVERIDAD_DE_CUSTODIA`: mismo criterio. */
export const SEVERIDAD_DEL_CIERRE = "media";
