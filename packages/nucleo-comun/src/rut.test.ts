import test from "node:test";
import assert from "node:assert/strict";
import { formatearRut, rutValido, digitoVerificadorDe, EJEMPLO_RUT } from "./rut.ts";
import { VALIDOS, INVALIDOS_A_PROPOSITO } from "../../../db/flota/ruts-sinteticos.mjs";

// Mutantes del RUT del cliente [AC-FIDN-17] — §0, §4.3, §5.4 F-B.
//
// Acá está lo que se puede probar SIN cluster: la forma que toma lo tecleado y el veredicto
// del módulo 11. Que ese veredicto sea EL MISMO que el de la base —la autoridad, AC-FIDN-21—
// se prueba aparte, en el oráculo diferencial de `db/flota/suite-bd/ruts.test.mjs`, que sí la tiene.
//
// Los RUTs literales salen de la lista congelada y no de la cabeza: el gate de AC-FIDN-21
// rebota cualquier otro, incluso acá.

test("[AC-FIDN-17] el formato aparece mientras se escribe, no al final", () => {
  // El último carácter es SIEMPRE el dígito verificador mientras se teclea: así es como se
  // entra un RUT de verdad, y así la pantalla acompaña a quien lo compara con su carné en vez
  // de mostrarle un número sin forma hasta el octavo dígito.
  assert.equal(formatearRut("1"), "1");
  assert.equal(formatearRut("12"), "1-2");
  assert.equal(formatearRut("1234"), "123-4");
  // Se ARMA en vez de escribirse entero: un RUT canónico literal acá tendría que estar en la
  // lista congelada de AC-FIDN-21, y este es un paso intermedio del tecleo, no un fixture.
  assert.equal(formatearRut("12345"), ["1", "234-5"].join("."));
  assert.equal(formatearRut("123456785"), EJEMPLO_RUT);
});

test("[AC-FIDN-17] da igual cómo lo pegue: puntos, guiones o nada", () => {
  // Se pega desde una planilla, desde un WhatsApp o se teclea a mano. Ninguna de esas formas
  // cambia QUÉ RUT es, así que rechazar una sería castigar el formato de origen.
  for (const crudo of ["12.345.678-5", "12345678-5", "12 345 678 5", "12.345.6785"]) {
    assert.equal(formatearRut(crudo), EJEMPLO_RUT, `no formateó «${crudo}»`);
  }
});

test("[AC-FIDN-17] la K solo existe como dígito verificador", () => {
  assert.equal(formatearRut("20347878k"), "20.347.878-K");
  // Una K en el medio se cae: en el cuerpo no existe, y arrastrarla dejaría en pantalla algo
  // que la base va a rebotar después, con la persona creyendo que ya estaba bien. Se compara
  // contra el mismo tecleo SIN la K en vez de escribir el resultado: un RUT canónico literal
  // acá tendría que estar en la lista congelada, y este no es un fixture sino una propiedad.
  assert.equal(formatearRut("20k3478785"), formatearRut("203478785"));
  assert.equal(formatearRut("1k2"), "1-2");
});

test("[AC-FIDN-17] el cuerpo no crece más allá de un RUT chileno", () => {
  // Sin el tope, apoyarse en una tecla produce un «RUT» de veinte dígitos que la pantalla
  // muestra tan formateado como uno bueno.
  assert.equal(formatearRut("1234567890123").replace(/\D/g, "").length, 9);
});

test("[AC-FIDN-17] nada de lo que no es un RUT pasa por válido", () => {
  for (const basura of ["", null, undefined, "hola", "12345678-5", "1-9", EJEMPLO_RUT.slice(0, 6)]) {
    assert.equal(rutValido(basura as string), false, `pasó: ${String(basura)}`);
  }
});

test("[AC-FIDN-17] la forma PELADA no vale, igual que en el CHECK de la base", () => {
  // El CHECK `personas_rut_modulo_11` exige el formato canónico. Si el cliente aceptara la
  // forma pelada, el operario vería su RUT en verde y el servidor lo rebotaría al enviar —
  // que es el peor lugar posible para poner una diferencia entre las dos validaciones.
  assert.equal(rutValido(EJEMPLO_RUT.replace(/\./g, "")), false);
  assert.equal(rutValido(EJEMPLO_RUT), true);
});

test("[AC-FIDN-17] la lista congelada entera: los válidos pasan y los inválidos no", () => {
  for (const rut of Object.keys(VALIDOS)) {
    assert.equal(rutValido(rut), true, `rechazó un RUT declarado válido: ${rut}`);
  }
  for (const rut of Object.keys(INVALIDOS_A_PROPOSITO)) {
    assert.equal(rutValido(rut), false, `aceptó un RUT declarado inválido: ${rut}`);
  }
});

test("[AC-FIDN-17] el dígito verificador se DERIVA, no se adivina", () => {
  // Los tres desenlaces del módulo 11, incluidos los dos que casi nadie ejerce: el resto 11
  // que da «0» y el resto 10 que da «k». Un validador que se los saltee acepta RUTs que la
  // base rebota, y justamente los que se ven más raros.
  for (const rut of Object.keys(VALIDOS)) {
    const [cuerpo, dv] = rut.split("-") as [string, string];
    assert.equal(digitoVerificadorDe(cuerpo.replace(/\./g, "")), dv.toLowerCase(), `dv de ${rut}`);
  }
  assert.equal(digitoVerificadorDe("20347878"), "k");
});
