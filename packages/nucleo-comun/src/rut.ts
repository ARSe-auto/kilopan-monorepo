import { FORMATOS } from "./constants.ts";

// El RUT del lado del CLIENTE: formato mientras se escribe y módulo 11 en línea [AC-FIDN-17].
// §0 (formato canónico `12.345.678-5`, validación módulo 11 al escribir), §4.3, §5.4 F-B.
//
// ─── POR QUÉ EXISTE UNA SEGUNDA IMPLEMENTACIÓN, SI LA AUTORIDAD ES LA BASE ─────────────
//
// AC-FIDN-21 dejó escrito que hay UNA implementación del módulo 11 y vive en la BD
// (`rut_valido()`), para que dos algoritmos no se separen. Esto NO la contradice: el maestro
// pide validación «en cliente Y servidor», y la del cliente tiene que correr SIN RED —el §4.3
// la quiere AL ESCRIBIR, tecla a tecla, y en un galpón sin señal—. Preguntarle a la base por
// cada dígito no es una alternativa, es otro producto.
//
// Lo que se hace en cambio es cerrar la divergencia con un ORÁCULO en vez de con una promesa:
// `db/flota/suite-bd/ruts.test.mjs` pasa la lista congelada entera por las DOS
// implementaciones y exige el MISMO veredicto para cada RUT. El día que alguien toque una
// sola, el gate se pone rojo con el RUT en el que difieren. Dos implementaciones obligadas por
// el producto se vigilan; una copia silenciosa no.
//
// ─── QUÉ VALIDA, EXACTAMENTE LO MISMO QUE EL CHECK ────────────────────────────────────
//
// Formato canónico con puntos de miles y guion. Aceptar además la forma pelada haría que la
// app diera por bueno lo que la base rebota, y el operario vería su RUT aceptado en pantalla
// y rechazado al enviar — el peor lugar donde poner una diferencia.

/** El alfabeto de un RUT: dígitos, más la K del dígito verificador. */
const CARACTERES = /[^0-9kK]/g;
/** La forma canónica del §0. Es el mismo patrón que el CHECK `personas_rut_modulo_11`. */
const CANONICO = /^\d{1,3}(\.\d{3})+-[\dkK]$/;
/** Cuerpo máximo de un RUT chileno. Más dígitos no es un RUT: es alguien apoyado en la tecla. */
const CUERPO_MAX = 8;

/**
 * Da forma a lo que se está tecleando, sin juzgarlo. `123456785` → `12.345.678-5`.
 *
 * EL ÚLTIMO CARÁCTER ES SIEMPRE EL DÍGITO VERIFICADOR mientras se escribe, que es como se
 * teclea un RUT de verdad: se entra el número entero y el dv queda al final. La alternativa
 * —esperar a tener ocho dígitos para recién poner el guion— deja la pantalla mostrando un
 * número sin forma justo mientras la persona lo compara con su carné.
 *
 * No inventa nada: si sobran dígitos los descarta por la derecha del cuerpo, y una K que
 * aparezca en medio se cae, porque en el medio no existe.
 */
export function formatearRut(crudo: string | null | undefined): string {
  const limpio = String(crudo ?? "").replace(CARACTERES, "");
  if (limpio.length === 0) return "";
  const dv = limpio.slice(-1).toUpperCase();
  const cuerpo = limpio.slice(0, -1).replace(/[kK]/g, "").slice(0, CUERPO_MAX);
  if (cuerpo.length === 0) return dv;
  return `${conPuntos(cuerpo)}-${dv}`;
}

/** Puntos de miles desde la derecha, que es como los pone el §0 y como se lee el carné. */
function conPuntos(cuerpo: string): string {
  return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * ¿Es un RUT válido? Formato canónico Y módulo 11, en ese orden y sin excepciones.
 *
 * Devuelve `false` para todo lo demás —vacío, a medio escribir, con letras— porque para quien
 * llama solo hay dos respuestas posibles: se puede enviar o no se puede. Distinguir «todavía
 * no» de «está mal» es trabajo de la pantalla, que sabe si la persona sigue tecleando.
 */
export function rutValido(rut: string | null | undefined): boolean {
  const texto = String(rut ?? "");
  if (!CANONICO.test(texto)) return false;
  const [cuerpoConPuntos, dv] = texto.split("-") as [string, string];
  const cuerpo = cuerpoConPuntos.replace(/\./g, "");
  return dv.toLowerCase() === digitoVerificadorDe(cuerpo);
}

/**
 * El módulo 11 del §0: se recorre el cuerpo de derecha a izquierda multiplicando por la serie
 * 2,3,4,5,6,7 que vuelve a empezar. Es la MISMA aritmética que `rut_valido()` en la base, y la
 * suite diferencial existe para que siga siéndolo.
 */
export function digitoVerificadorDe(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "k";
  return String(resto);
}

/** El ejemplo que ven las pantallas. Sale del canónico §0 y no de un literal en un `input`. */
export const EJEMPLO_RUT = FORMATOS.ejemplo_rut;
