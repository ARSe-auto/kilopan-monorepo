// Máscaras para lo que no puede salir entero de la aplicación (§7.8, Ley 21.719).
//
// Existe UNA implementación porque una máscara reescrita en cada archivo es una máscara que
// un día se escribe mal y nadie lo nota: el log sigue saliendo, con el dato entero adentro.

/**
 * `12.345.678-5` → `**.***.***-5`. Queda el dígito verificador y nada más.
 *
 * Por qué solo el DV: en un log lo que hace falta es poder distinguir dos líneas y correlacionar
 * un caso, no identificar a la persona. Dejar los últimos dígitos del cuerpo —la costumbre en
 * otros documentos— acá sería un error: el RUT chileno es corto y su DV se DERIVA del cuerpo,
 * así que con tres dígitos y el verificador el espacio que queda por probar es de miles, no de
 * millones. Con el cuerpo enmascarado entero no queda nada que reconstruir.
 *
 * Lo que no es un RUT no se «arregla»: se devuelve una marca fija. Enmascarar a medias una
 * cadena inesperada es la vía por la que un valor crudo termina en el log con forma de máscara.
 */
export function enmascararRut(rut: string | null | undefined): string {
  const texto = String(rut ?? "");
  const m = /^(\d{1,3}(?:\.\d{3})+)-([\dkK])$/.exec(texto);
  if (!m) return "rut-invalido";
  const cuerpo = m[1]!.replace(/\d/g, "*");
  return `${cuerpo}-${m[2]!.toLowerCase()}`;
}
