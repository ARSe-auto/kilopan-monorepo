import { test } from "node:test";
import assert from "node:assert/strict";
import { iniciarRastreo, type ObservadorDeGps } from "./rastreo.ts";

// [AC-FTEL-01] §7.8: el rastreo arranca con `watchPosition` y SIEMPRE devuelve la función que
// lo apaga — el llamador (el componente de pantalla) la ejecuta cuando el turno cierra.

test("[AC-FTEL-01] arranca watchPosition y la función devuelta lo apaga", () => {
  let detenido = false;
  const observador: ObservadorDeGps = {
    watchPosition: () => 7,
    clearWatch: (id) => {
      assert.equal(id, 7, "detuvo un watch distinto del que arrancó");
      detenido = true;
    },
  };
  const detener = iniciarRastreo("turno-1", observador);
  assert.equal(detenido, false, "se detuvo antes de que nadie lo pidiera");
  detener();
  assert.equal(detenido, true, "la función devuelta no detuvo el watch");
});

test("[AC-FTEL-01] sin soporte de geolocalización, degrada sin lanzar", () => {
  assert.doesNotThrow(() => iniciarRastreo("turno-1", null)());
});
