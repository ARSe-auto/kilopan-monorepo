// El maestro teclea KILOS; la base guarda GRAMOS enteros. Esta es la única frontera
// entre las dos cosas.
//
// Por qué la base sigue en gramos enteros: la TCK es un cociente de sumas de pesos.
// Guardar kilos como decimal metería deriva de punto flotante justo en la métrica que
// define el producto — el mismo motivo por el que el dinero se guarda en CLP enteros
// y no en pesos con centavos.
//
// Y por qué el parseo es por TEXTO y no `Number(kg) * 1000`: en JS `0.1 * 1000` da
// 100.00000000000001, y `2.3 * 1000` da 2299.9999999999995. Multiplicar flotantes para
// llegar a un entero es exactamente cómo se pierde un gramo por pesaje, todos los días,
// sin que nadie lo note hasta que la conciliación no cuadra.

const MAX_GRAMOS = 100_000; // 100 kg — el CHECK de pan.pesajes

/** "1,5" -> 1500 · "0,25" -> 250 · "12" -> 12000. Acepta coma es-CL o punto. */
export function kgTextoAGramos(texto: string): number {
  const limpio = String(texto ?? "").trim().replace(".", ",");
  if (limpio === "" || limpio === ",") return 0;

  const partes = limpio.split(",");
  if (partes.length > 2) {
    throw new RangeError(`kgTextoAGramos: peso mal formado (${texto})`);
  }
  const [entero = "", decimales = ""] = partes;
  if (!/^\d*$/.test(entero) || !/^\d*$/.test(decimales)) {
    throw new RangeError(`kgTextoAGramos: peso mal formado (${texto})`);
  }
  if (decimales.length > 3) {
    // 3 decimales = 1 gramo, la resolución real de una báscula de panadería.
    throw new RangeError(`kgTextoAGramos: más de 3 decimales no es un peso real (${texto})`);
  }

  // Aritmética ENTERA: sin esto vuelve el problema del flotante descrito arriba.
  const gramos = (Number(entero || "0") * 1000) + Number(decimales.padEnd(3, "0") || "0");
  return gramos;
}

/** ¿Es un peso que la BD va a aceptar? Se usa para habilitar el botón, no para
 *  validar de verdad — eso lo hace el CHECK de la tabla, que es el que manda. */
export function pesoValido(gramos: number): boolean {
  return Number.isInteger(gramos) && gramos >= 1 && gramos <= MAX_GRAMOS;
}

/** 1500 -> "1,5" — para precargar un campo editable con lo que ya está guardado.
 *  Sin ceros de relleno: "1,5" y no "1,500", que en una pantalla se lee como mil quinientos. */
export function gramosAKgTexto(gramos: number): string {
  if (!Number.isInteger(gramos)) {
    throw new RangeError(`gramosAKgTexto: gramos debe ser entero (${gramos})`);
  }
  const entero = Math.floor(gramos / 1000);
  const resto = gramos % 1000;
  if (resto === 0) return String(entero);
  return `${entero},${String(resto).padStart(3, "0").replace(/0+$/, "")}`;
}
