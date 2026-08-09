#!/usr/bin/env node
// Mutantes del gate de consentimiento [AC-FIDN-20] — §7.8.
//
// Un gate sin mutantes es un `grep` que nadie ejerció: pasa en verde igual si su patrón está
// mal escrito. Acá cada familia prohibida entra con el caso que TIENE que atrapar, y con el
// caso legítimo que NO puede marcar — porque el segundo es el que decide si el gate sobrevive
// a la primera semana o si alguien lo apaga por ruidoso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { revisarArchivo, PROHIBIDOS, PANTALLAS_MINIMAS, ENDPOINTS_DE_ENROLAMIENTO } from "./gate-consentimiento.mjs";

/** Una pantalla del flujo: lo es porque llama al endpoint, no porque se llame de algún modo. */
const pantalla = (cuerpo) => `await fetch("${ENDPOINTS_DE_ENROLAMIENTO[0]}", { method: "POST" });\n${cuerpo}`;
const motivos = (cuerpo) => revisarArchivo("x.tsx", pantalla(cuerpo)).problemas.map((p) => p.motivo);

test("[AC-FIDN-20] el checkbox de consentimiento, en sus dos formas, se atrapa", () => {
  assert.equal(motivos(`<input type="checkbox" name="acepta" />`).length > 0, true);
  assert.equal(motivos(`<div role="checkbox" aria-checked={false} />`).length > 0, true);
});

test("[AC-FIDN-20] el consentimiento SIN checkbox también, que es el que pasa desapercibido", () => {
  // Un párrafo que dice «al continuar aceptás» hace exactamente lo mismo que marcar una
  // casilla, y encima sin dejar rastro de que la persona decidió algo.
  for (const texto of [
    `<p>Al continuar aceptás el tratamiento de tus datos.</p>`,
    `<p>Doy mi consentimiento para el uso de mis datos.</p>`,
    `<p>Autorizo el uso de mi RUT.</p>`,
    `<a href="/legal">Términos y condiciones</a>`,
    `<a href="/legal">Política de privacidad</a>`,
  ]) {
    assert.ok(motivos(texto).length > 0, `no atrapó: ${texto}`);
  }
});

test("[AC-FIDN-20] una pantalla del enrolamiento SIN consentimiento pasa limpia", () => {
  // El positivo. Sin él, un patrón que se disparara con cualquier cosa dejaría el gate en rojo
  // permanente y el arreglo cómodo sería ablandarlo hasta que no mire nada.
  assert.deepEqual(
    motivos(`<h1>Solicitar acceso</h1><output data-testid="rut" /><button>Solicitar acceso</button>`),
    [],
  );
});

test("[AC-FIDN-20] una pantalla que NO llama a los endpoints no es del flujo y no se juzga", () => {
  // El wizard de alta del tenant SÍ presenta términos y DPA (AC-FMIG-22, hito g): los acepta
  // el admin contratando un servicio, no un trabajador entregando su RUT para poder trabajar.
  // Si este gate los marcara, chocaría con ese AC y alguien lo apagaría.
  const wizard = `<label><input type="checkbox" /> Acepto los términos y condiciones</label>`;
  const veredicto = revisarArchivo("wizard/page.tsx", wizard);
  assert.equal(veredicto.esDelFlujo, false);
  assert.deepEqual(veredicto.problemas, []);
});

test("[AC-FIDN-20] un comentario que EXPLICA la regla no es una violación de la regla", () => {
  // Sin esto, documentar por qué no hay consentimiento sería lo que pone el gate en rojo — y
  // un gate que castiga su propia explicación es un gate que alguien borra con el comentario.
  assert.deepEqual(motivos(`// CERO consentimiento: la base de licitud es el contrato, no el consentimiento.`), []);
  assert.deepEqual(motivos(`  {/* nada de términos y condiciones acá */}`), []);
});

test("[AC-FIDN-20] la lista de prohibidos no está vacía ni tiene un patrón muerto", () => {
  assert.ok(PROHIBIDOS.length > 0, "sin patrones el gate no vigila nada");
  for (const { nombre, patron } of PROHIBIDOS) {
    assert.ok(nombre.length > 3, "cada patrón se nombra, para que el rojo diga qué encontró");
    assert.ok(patron instanceof RegExp);
  }
  assert.ok(PANTALLAS_MINIMAS >= 2, "F-B y F-E son dos: menos de eso no es un piso");
});

test("[AC-FIDN-20] el repo real pasa el gate, y encuentra las pantallas que dice mirar", () => {
  const salida = execFileSync("node", [new URL("gate-consentimiento.mjs", import.meta.url).pathname], {
    encoding: "utf8",
  });
  assert.match(salida, /VERDE/);
  // Anti-vacuidad sobre el repo de verdad: si el alcance quedara vacío, el VERDE de arriba no
  // significaría nada.
  assert.match(salida, /solicitar\/page\.tsx/);
  assert.match(salida, /ya-tengo-cuenta\/page\.tsx/);
});
