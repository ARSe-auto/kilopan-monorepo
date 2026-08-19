import { test } from "node:test";
import assert from "node:assert/strict";
import { iniciarRastreo, type ObservadorDeGps, type PosicionCruda } from "./rastreo.ts";

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
  const detener = iniciarRastreo(() => {}, observador);
  assert.equal(detenido, false, "se detuvo antes de que nadie lo pidiera");
  detener();
  assert.equal(detenido, true, "la función devuelta no detuvo el watch");
});

test("[AC-FTEL-01] sin soporte de geolocalización, degrada sin lanzar", () => {
  assert.doesNotThrow(() => iniciarRastreo(() => {}, null)());
});

// [AC-FTEL-03] §4.6: el captor no postea nada — entrega cada fix a quien llama, que es quien lo
// encola en el outbox. Este test prueba EXACTAMENTE eso: que el transporte quedó desacoplado del
// `fetch` directo que tenía antes.
type Exito = (posicion: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;

test("[AC-FTEL-03] cada fix se entrega a quien llama, con lat/lng/precisión — nada de POST directo", () => {
  const capturadas: PosicionCruda[] = [];
  const exitos: Exito[] = [];
  const observador: ObservadorDeGps = {
    watchPosition: (ex) => {
      exitos.push(ex);
      return 1;
    },
    clearWatch: () => {},
  };
  iniciarRastreo((p) => capturadas.push(p), observador);
  assert.equal(exitos.length, 1, "watchPosition no guardó el callback de éxito");
  exitos[0]!({ coords: { latitude: -33.45, longitude: -70.66, accuracy: 12 } });
  assert.deepEqual(capturadas, [{ lat: -33.45, lng: -70.66, precisionM: 12 }]);
});

test("[AC-FTEL-03] accuracy no finito (NaN/Infinity) degrada a precisionM null, no rebota", () => {
  const capturadas: PosicionCruda[] = [];
  const exitos: Exito[] = [];
  const observador: ObservadorDeGps = {
    watchPosition: (ex) => {
      exitos.push(ex);
      return 1;
    },
    clearWatch: () => {},
  };
  iniciarRastreo((p) => capturadas.push(p), observador);
  exitos[0]!({ coords: { latitude: -33.45, longitude: -70.66, accuracy: NaN } });
  assert.equal(capturadas[0]!.precisionM, null);
});
