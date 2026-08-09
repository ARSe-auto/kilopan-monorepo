import test from "node:test";
import assert from "node:assert/strict";
import { enmascararRut } from "./mascaras.ts";

// Mutantes de la máscara de RUT [AC-FIDN-06] — §7.8.

test("[AC-FIDN-06] del RUT enmascarado no queda ningún dígito del cuerpo", () => {
  assert.equal(enmascararRut("12.345.678-5"), "**.***.***-5");
  assert.equal(enmascararRut("9.999.999-3"), "*.***.***-3");
  assert.equal(enmascararRut("20.347.878-K"), "**.***.***-k");
});

test("[AC-FIDN-06] la máscara no deja reconstruir el RUT", () => {
  // Dejar los últimos dígitos —la costumbre en otros documentos— acá sería un error: el DV se
  // DERIVA del cuerpo, así que con tres dígitos visibles el espacio por probar es de miles.
  // Esta prueba fija la propiedad: dos RUTs distintos con el mismo DV se ven IGUAL.
  assert.equal(enmascararRut("12.345.678-5"), enmascararRut("11.111.116-5"));
  for (const rut of ["12.345.678-5", "9.999.999-3", "20.347.878-K"]) {
    // Solo el CUERPO: el dígito verificador queda a propósito, así que buscarlo en la cadena
    // entera daría un falso rojo cada vez que el DV se repite dentro del cuerpo.
    const cuerpoEnmascarado = enmascararRut(rut).split("-")[0]!;
    assert.equal(/\d/.test(cuerpoEnmascarado), false, `quedaron dígitos: ${cuerpoEnmascarado}`);
    assert.equal(cuerpoEnmascarado.replace(/\*/g, "").replace(/\./g, ""), "");
  }
});

test("[AC-FIDN-06] lo que no es un RUT no se enmascara a medias: se marca", () => {
  // Enmascarar «lo que se pueda» de una cadena inesperada es la vía por la que un valor crudo
  // termina en el log disfrazado de máscara.
  for (const basura of ["", "12345678-5", "hola", "12.345.678", null, undefined]) {
    assert.equal(enmascararRut(basura), "rut-invalido", `pasó: ${String(basura)}`);
  }
});
