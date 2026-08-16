#!/usr/bin/env node
// Mutantes del scan de logs [AC-FIDN-06].
//
// Esta regla va a estar años sin disparar, porque el código que la viola FUNCIONA: un
// `console.error` con el PIN adentro anda perfecto hasta el día que alguien lee el log. Así
// que cada patrón se ejerce contra el caso que atrapa Y contra un positivo que impide que sea
// un no-op al revés — un patrón demasiado ancho se ve igual que uno bueno hasta que marca
// código sano, y ahí alguien lo apaga.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { revisarArchivo } from "./gate-logs.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const motivos = (contenido) => revisarArchivo("x.ts", contenido).map((p) => p.motivo);

test("[AC-FIDN-06] el repo real pasa el scan de logs", () => {
  const salida = execFileSync("node", [`${RAIZ}/db/flota/gate-logs.mjs`], { encoding: "utf8" });
  assert.match(salida, /gate-logs: VERDE/);
  // Y que haya mirado algo: un alcance vacío daría VERDE sin abrir un archivo.
  assert.doesNotMatch(salida, /× 0 archivos/, "el gate no revisó ningún archivo");
});

test("[AC-FIDN-06] un PIN en un log ⇒ ROJO, venga como valor o como hash", () => {
  assert.equal(motivos(`console.log("intento", pin);`).length, 1);
  assert.equal(motivos(`console.error("fallo", { pin_hash: fila.pin_hash });`).length, 1);
  assert.equal(motivos(`process.stderr.write(pinNuevo);`).length, 1);
  // El hash de un PIN tan corto es el PIN a un rato de cómputo: «en cualquier forma» lo
  // incluye, y el motivo tiene que decir por qué, no solo que no.
  assert.match(motivos(`console.log(pin_hash);`)[0], /ninguna forma/);
});

test("[AC-FIDN-06] un RUT sin máscara ⇒ ROJO; con máscara ⇒ pasa", () => {
  assert.match(motivos(`console.log("persona", rut);`)[0], /enmascararRut/);
  // El positivo, y es el que hace útil a la regla: si enmascarado tampoco pasara, la única
  // forma de tener logs sería no loguear, y entonces alguien apaga el gate.
  assert.deepEqual(motivos(`console.log("persona", enmascararRut(rut));`), []);
});

test("[AC-FIDN-06] el secreto del dispositivo no sale en ninguna forma", () => {
  assert.equal(motivos(`console.warn("emitido", secreto);`).length, 1);
  assert.equal(motivos(`console.warn("emitido", secretoHash);`).length, 1);
});

test("[AC-FIDN-06] «ruteo» NO dispara la regla del RUT: la frontera de palabra existe", () => {
  // El bug que este test evita es real y está en el árbol: `servidor.mjs` tiene un
  // `console.error("ruteo: fallo resolviendo el host", error)` perfectamente sano. Un gate
  // que lo marcara sería un gate apagado a la semana, y uno apagado no protege nada.
  assert.deepEqual(motivos(`console.error("ruteo: fallo resolviendo el host", error);`), []);
  assert.deepEqual(motivos(`console.log("ruta", ruta, "rutas", rutas);`), []);
  assert.deepEqual(motivos(`console.log("spinner", spin);`), []);
});

test("[AC-FIDN-06] una línea que NO es un log no dispara, aunque nombre el dato", () => {
  // El dato tiene que poder circular por el código: lo que se prohíbe es que salga por un log.
  assert.deepEqual(motivos(`const pin = cuerpo.pin;`), []);
  assert.deepEqual(motivos(`await verificarHash(fila.pin_hash, pin);`), []);
});

test("[AC-FIDN-06] un comentario que EXPLICA la regla no es una violación de la regla", () => {
  // Sin esto, escribir «no mandar el pin a console.log» pondría el gate en rojo, y la regla
  // se pisaría con su propia explicación.
  assert.deepEqual(motivos(`// nunca console.log(pin): el §7.8 lo prohíbe`), []);
  assert.deepEqual(motivos(`   * console.error("rut", rut) sería una fuga`), []);
});

test("[AC-FIDN-06] el gate señala archivo, línea y qué hacer", () => {
  const [p] = revisarArchivo("apps/flota/src/x.ts", `const a = 1;\nconsole.log(rut);\n`);
  assert.equal(p.archivo, "apps/flota/src/x.ts");
  assert.equal(p.linea, 2);
  assert.match(p.texto, /console\.log/);
});
